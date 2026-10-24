#!/usr/bin/env python3
# 从上游目录和只读上传资料生成统一目录、图片资源、旧版映射及审计报告。
# 仅在需要重建数据时运行；输入由 --sources 指定，产物由 --suite 指定，日常改界面无需重建。

"""Normalize the checked-in catalog and read-only uploads without running JavaScript.

Run from any directory. Only Python's standard library is required. Uploaded
market prices and guessNew_Box_Id.json deliberately never enter the catalog.
Use --generated-at or SOURCE_DATE_EPOCH to reproduce identical output bytes.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
from urllib.parse import quote
import zipfile


SUITE = Path(__file__).resolve().parents[1]
KNOWN_COMMIT = "1f31daf9edc7c0afb3ddc6744cd5809ca911957f"
SPECIAL_BOX_PRICES = {
    "冬隐归路 霜星角色礼盒": 159,
    "愚夜密函礼盒-W角色套组": 48,
    "明日方舟官方美术设定集VOL.1": 259,
}
SERIES_ALIASES = {
    "2021音律联觉SP-ManiFesto": "ManiFesto:",
    "2024不觅浪尘SP-FIVE超新星": "超新星",
    "通行认证SP-集成映射：野趣拾光": "野趣拾光",
    "通行认证SP-彩六联动 1期": "战术交汇",
    "通行认证SP-彩六联动 2期": "水晶箭行动",
    "通行认证SP-罗小黑战记": "通行喵",
    "明日方舟官方美术设定集VOL.1": "第一期设定集赠品",
}


# 计算输入字节的 SHA-256，用于来源记录、稳定 ID 和目录版本。
def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# 根据精确旧名称生成带类型前缀的稳定 ID；改名会改变 ID，影响已有收藏映射。
def stable_id(prefix: str, identity: str) -> str:
    return prefix + "_" + digest(identity.encode("utf-8"))[:16]


# 用稳定键顺序输出 UTF-8 JSON；pretty 控制缩进，不转义中文。
def serialize(value: object, pretty: bool = True) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       indent=2 if pretty else None,
                       separators=None if pretty else (",", ":")) + "\n").encode("utf-8")


# 先写目标同目录的临时文件，再原子替换，避免读到未写完的单个产物。
def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        handle.write(data)
        temp = Path(handle.name)
    try:
        temp.chmod(0o644)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


# 仅解析受限的 JavaScript 字面量，避免执行上游 data.js 中的任意代码。
class LiteralReader:
    """A small literal parser: strings, numbers, booleans, arrays and objects.

    It accepts unquoted object keys and trailing commas, but has no evaluator,
    imports, function calls, property access or JavaScript execution facility.
    """

    ignored = re.compile(r"(?:\s+|//[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*")
    identifier = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
    number = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?")

    # 保存源文本和起始游标；后续每次读取都会推进 offset。
    def __init__(self, text: str, offset: int = 0):
        self.text, self.offset = text, offset

    # 跳过空白和注释，使游标停在下一个有效 token 上。
    def skip(self) -> None:
        self.offset = self.ignored.match(self.text, self.offset).end()

    # 要求当前位置出现指定 token；不匹配时带游标位置报错。
    def consume(self, token: str) -> None:
        self.skip()
        if not self.text.startswith(token, self.offset):
            raise ValueError(f"Expected {token!r} at position {self.offset}")
        self.offset += len(token)

    # 递归读取字符串、数组、对象、数值、布尔值或 null，拒绝可执行表达式。
    def value(self) -> object:
        self.skip()
        char = self.text[self.offset:self.offset + 1]
        if char == '"':
            value, end = json.JSONDecoder().raw_decode(self.text[self.offset:])
            if not isinstance(value, str):
                raise ValueError("Expected a string")
            self.offset += end
            return value
        if char == "[":
            self.offset += 1
            result = []
            while True:
                self.skip()
                if self.text[self.offset:self.offset + 1] == "]":
                    self.offset += 1
                    return result
                result.append(self.value())
                self.skip()
                if self.text[self.offset:self.offset + 1] != "]":
                    self.consume(",")
        if char == "{":
            self.offset += 1
            result = {}
            while True:
                self.skip()
                if self.text[self.offset:self.offset + 1] == "}":
                    self.offset += 1
                    return result
                if self.text[self.offset:self.offset + 1] == '"':
                    key = self.value()
                else:
                    match = self.identifier.match(self.text, self.offset)
                    if not match:
                        raise ValueError(f"Invalid key at {self.offset}")
                    key, self.offset = match.group(), match.end()
                if key in result:
                    raise ValueError(f"Duplicate object key: {key}")
                self.consume(":")
                result[key] = self.value()
                self.skip()
                if self.text[self.offset:self.offset + 1] != "}":
                    self.consume(",")
        match = self.number.match(self.text, self.offset)
        if match:
            self.offset = match.end()
            return json.loads(match.group())
        for token, value in (("true", True), ("false", False), ("null", None)):
            if self.text.startswith(token, self.offset):
                self.offset += len(token)
                return value
        raise ValueError(f"Unsupported non-literal JavaScript at {self.offset}")


# 读取指定 window 数据赋值，并核对精一/精二拆分表达式仍符合已审查规则。
def parse_source(text: str) -> dict:
    data = {}
    for name in ("LOW_STAR", "PASS_DATA", "OPERATOR_INFO", "FACTION_LOGO", "OPERATOR_ALIAS"):
        matches = list(re.finditer(r"\bwindow\." + name + r"\s*=\s*", text))
        if len(matches) != 1:
            raise ValueError(f"Expected one window.{name} assignment")
        reader = LiteralReader(text, matches[0].end())
        if name == "LOW_STAR":
            reader.consume("new Set(")
            data[name] = reader.value()
            reader.consume(")")
        else:
            data[name] = reader.value()
        reader.consume(";")
    # This source computes the split set with a filter/map expression. Recognize
    # its exact restricted meaning rather than evaluating arbitrary code.
    pattern = (r"window\.SPLIT_ELITE_SERIES\s*=\s*new Set\(\[\s*"
               r"\.\.\.window\.PASS_DATA\.filter\(s\s*=>\s*s\.type\s*===\s*'main'"
               r"\s*\|\|\s*s\.type\s*===\s*'collab'\)\.map\(s\s*=>\s*s\.series\)"
               r"\s*\]\);\s*$")
    if not re.search(pattern, text):
        raise ValueError("SPLIT_ELITE_SERIES rule changed; manually review before rebuilding")
    data["SPLIT_ELITE_SERIES"] = {
        entry["series"] for entry in data["PASS_DATA"] if entry["type"] in ("main", "collab")
    }
    return data


# 以只读方式检查 ZIP 的成员路径、大小、重复项及 CRC，再提供受限读取。
class SafeArchive:
    # 校验压缩包，不直接解压；拒绝路径穿越、符号链接、加密项和超限文件。
    def __init__(self, path: Path):
        self.path = path
        self.hash = digest(path.read_bytes())
        self.zip = zipfile.ZipFile(path)
        infos = self.zip.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > 250_000_000:
            raise ValueError(f"Archive exceeds size limits: {path.name}")
        self.names = set()
        for info in infos:
            name = info.filename
            parts = PurePosixPath(name).parts
            if (not parts or name.startswith("/") or "\\" in name or "\0" in info.orig_filename
                    or ".." in parts or re.match(r"^[A-Za-z]:", name)):
                raise ValueError(f"Unsafe ZIP path: {name!r}")
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode) or info.flag_bits & 1:
                raise ValueError(f"Unsupported ZIP entry: {name!r}")
            if info.file_size > 25_000_000:
                raise ValueError(f"Oversized ZIP entry: {name!r}")
            if name in self.names:
                raise ValueError(f"Duplicate ZIP entry: {name!r}")
            self.names.add(name)
        bad = self.zip.testzip()
        if bad:
            raise ValueError(f"ZIP checksum failed: {bad}")

    # 选择指定文件名最浅层且唯一的成员，避免早期 resource/ 副本替代主表。
    def find(self, filename: str) -> str:
        candidates = sorted(name for name in self.names if name.endswith("/" + filename))
        # The archive also contains early resource/ copies. The root member is
        # authoritative; nested copies must never silently replace it.
        if candidates:
            depth = min(name.count("/") for name in candidates)
            candidates = [name for name in candidates if name.count("/") == depth]
        if len(candidates) != 1:
            raise ValueError(f"Expected one archive file {filename}: {candidates}")
        return candidates[0]

    # 读取成员并按兼容 BOM 的 UTF-8 解码 JSON，不修改原 ZIP。
    def json(self, member: str) -> object:
        return json.loads(self.zip.read(member).decode("utf-8-sig"))


# 将年/月/日或年-月-日规范成 ISO 日期；空字符串返回 None，非法日期报错。
def normalize_date(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    match = re.fullmatch(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", value.strip())
    if not match:
        raise ValueError(f"Unsupported release/replicate date: {value!r}")
    return dt.date(*(int(item) for item in match.groups())).isoformat()


# 用编号或明确别名寻找补充盒号，返回（候选键，匹配依据），不做模糊猜测。
def supplementary_key(entry: dict) -> tuple[str | None, str]:
    name, kind = entry["series"], entry["type"]
    if kind == "main":
        return re.fullmatch(r"明日方舟通行认证 (\d+\.0)", name).group(1), "numbered_series"
    if kind == "endfield":
        return None, "different_game"
    if name in SERIES_ALIASES:
        return SERIES_ALIASES[name], "explicit_title_alias"
    if kind in ("sp", "carnival", "collab", "elite") and "SP-" in name:
        return name.split("SP-", 1)[1].replace("凭证 ", "凭证"), "exact_title_component"
    return None, "no_safe_identity_match"


# 解析来源 → 校验压缩包 → 合并元数据 → 生成系列/通行证 → 输出目录和审计。
# 调试数据差异可在 supplement 匹配、variants 拆分和 version 计算处设断点。
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", type=Path, default=SUITE)
    parser.add_argument("--sources", type=Path, default=SUITE.parent / "sources")
    parser.add_argument("--source-commit", default=KNOWN_COMMIT)
    parser.add_argument("--generated-at", help="ISO UTC timestamp for reproducible artifacts")
    args = parser.parse_args()
    suite, source_dir = args.suite.resolve(), args.sources.resolve()
    js_path = suite / "upstream/data.js"
    raw_js = js_path.read_bytes()
    source = parse_source(raw_js.decode("utf-8-sig"))
    uploaded = SafeArchive(source_dir / "ArknightsAuthorization_Series-main.zip")
    images = SafeArchive(source_dir / "images.zip")
    boxes_member = uploaded.find("Box_Id.json")
    boxes = uploaded.json(boxes_member)
    if not isinstance(boxes, list) or any(not isinstance(b.get("Box_id"), str) for b in boxes):
        raise ValueError("Box_id values must be strings")
    box_index = {b["Box_id"]: b for b in boxes}
    if len(box_index) != len(boxes):
        raise ValueError("Duplicate Box_id")
    readme_member = uploaded.find("README.md")
    readme = uploaded.zip.read(readme_member).decode("utf-8-sig")
    if "CC BY-NC 4.0" not in readme:
        raise ValueError("Uploaded data license changed; review before rebuilding")
    generated_at = args.generated_at
    if not generated_at:
        timestamp = int(os.environ["SOURCE_DATE_EPOCH"]) if "SOURCE_DATE_EPOCH" in os.environ else None
        generated_at = dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat().replace("+00:00", "Z") if timestamp is not None else dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    dt.datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    sources = [
        {"id": "primary", "kind": "catalog", "path": "upstream/data.js", "sha256": digest(raw_js),
         "repository": "https://github.com/SpectMercyRE/Arknights-pass-statistics", "commit": args.source_commit,
         "license": "MIT for original code; third-party data/images excluded; disclaimer requires non-commercial use",
         "attribution": "虚瞑 (SpectMercyRE), Bilibili @燎冬谣, 小红书 @KJCJS, PRTS wiki"},
        {"id": "supplement", "kind": "dates_and_barcodes", "path": "sources/ArknightsAuthorization_Series-main.zip",
         "sha256": uploaded.hash, "member": boxes_member, "member_sha256": digest(uploaded.zip.read(boxes_member)),
         "repository": "https://github.com/awadwd/ArknightsAuthorization_Series-mirror", "license": "CC BY-NC 4.0 except third-party assets",
         "attribution": "方舟通行证谷子查询工具 · 数据仓库 / ArknightsAuthorization_Series-mirror"},
        {"id": "images", "kind": "local_assets", "path": "sources/images.zip", "sha256": images.hash,
         "license": "Third-party game/merch artwork; no independent redistribution license supplied",
         "attribution": "上海鹰角网络科技有限公司 / 上海木鸢网络科技有限公司; uploaded by user"},
    ]
    audit = {"generated_at": generated_at, "sources": sources, "zip_integrity": "CRC passed; no unsafe paths or symlinks",
             "matches": [], "unmatched_primary_series": [], "assets": [], "missing_assets": [],
             "operator_metadata_missing": [], "warnings": [], "rules": {
                 "identity": "SHA256 of exact legacy names, first 16 hex digits, prefixed s_/p_/o_",
                 "pass_identity_separator": "|", "primary": "Only PASS_DATA determines series and passes",
                 "prices": "Official prices retained from original logic; no market prices imported",
                 "guesses": "guessNew_Box_Id.json deliberately excluded",
                 "years": "Upstream year retained verbatim; normalized release_date comes from uploaded Box_Id.json"}}
    warnings = audit["warnings"]
    asset_map = {}
    low_star = set(source["LOW_STAR"])
    used_boxes = set()
    legacy_series, legacy_passes = {}, {}
    operator_entries = {}

    # 只复制已引用且签名有效的图片，缓存 URL，并在审计中记录来源和摘要。
    def asset(member: str) -> str | None:
        if member not in images.names:
            if member not in audit["missing_assets"]:
                audit["missing_assets"].append(member)
            return None
        if member not in asset_map:
            relative = PurePosixPath(member).relative_to("images")
            destination = suite / "web/public/assets/images" / Path(*relative.parts)
            data = images.zip.read(member)
            if Path(member).suffix.lower() == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError(f"Invalid PNG signature: {member}")
            if Path(member).suffix.lower() in (".jpg", ".jpeg") and not data.startswith(b"\xff\xd8\xff"):
                raise ValueError(f"Invalid JPEG signature: {member}")
            atomic_write(destination, data)
            url = "/assets/images/" + quote(str(relative), safe="/-_.")
            asset_map[member] = url
            audit["assets"].append({"source": member, "url": url, "bytes": len(data), "sha256": digest(data)})
        return asset_map[member]

    series_records = []
    for entry in source["PASS_DATA"]:
        name, kind = entry["series"], entry["type"]
        series_id = stable_id("s", name)
        if name in legacy_series:
            raise ValueError(f"Duplicate legacy series: {name}")
        legacy_series[name] = series_id
        # 补充来源只提供可确定匹配的盒号、日期和条码；系列及干员列表仍以主体来源为准。
        key, strategy = supplementary_key(entry)
        supplement = box_index.get(key)
        match = None
        if supplement is not None:
            expected_type = {"main": None, "sp": "ambience", "carnival": "ambience", "collab": "cooperation", "elite": "whitelist", "special": "special"}[kind]
            if expected_type != supplement.get("Box_type"):
                warnings.append(f"{name}: uploaded box type differs; supplement excluded")
                supplement = None
            else:
                uploaded_names = [value["name"] for field, value in supplement.items()
                                  if re.fullmatch(r"character\d+", field) and isinstance(value, dict)]
                primary_names = entry["characters"]
                mismatch = sorted(set(uploaded_names) ^ set(primary_names))
                # Explicitly named series identify dates, even where one source
                # mistypes a character. Preserve the primary list and audit it.
                match = {"series": name, "series_id": series_id, "box_id": key, "strategy": strategy,
                         "primary_characters": primary_names, "supplement_characters": uploaded_names,
                         "character_difference": mismatch,
                         "release_date_raw": supplement.get("release_date"),
                         "barcode_source": boxes_member}
                if mismatch:
                    warnings.append(f"{name}: character names differ between sources; primary names retained")
                used_boxes.add(key)
                audit["matches"].append(match)
        if supplement is None:
            audit["unmatched_primary_series"].append({"series": name, "candidate_box_id": key, "reason": strategy})
        release_date = normalize_date(supplement.get("release_date")) if supplement else None
        replicate_dates = sorted({date for field, value in (supplement or {}).items()
                                  if field.startswith("replicate_date") and (date := normalize_date(value))})
        barcodes = set()
        if supplement:
            barcode_values = supplement.get("barcodes", [])
            if not isinstance(barcode_values, list):
                raise ValueError(f"barcodes is not a list: {key}")
            # 兼容旧单值 barcode 与新数组 barcodes，并集去重，避免空数组遮住旧条码。
            for barcode in [*barcode_values, supplement.get("barcode")]:
                if barcode in (None, ""):
                    continue
                if not isinstance(barcode, str) or not re.fullmatch(r"\d{8,14}", barcode):
                    raise ValueError(f"Invalid barcode for {key}: {barcode!r}")
                barcodes.add(barcode)
        if release_date and entry["year"] and release_date[:4] != entry["year"]:
            warnings.append(f"{name}: upstream year {entry['year']} differs from release_date {release_date}; both retained")
        fixed = SPECIAL_BOX_PRICES.get(name) if kind == "special" else None
        unit = (35 if "管理员凭证" in name else 30) if kind == "endfield" else 25
        passes = []
        for operator_name in entry["characters"]:
            operator_id = stable_id("o", operator_name)
            info = source["OPERATOR_INFO"].get(operator_name, {})
            if not info and operator_name not in audit["operator_metadata_missing"]:
                audit["operator_metadata_missing"].append(operator_name)
            rarity = info.get("rarity") or None
            if rarity is not None and (not isinstance(rarity, int) or not 1 <= rarity <= 6):
                raise ValueError(f"Invalid rarity for {operator_name}: {rarity}")
            if operator_name not in operator_entries:
                operator_entries[operator_name] = {"id": operator_id, "name": operator_name,
                    "class": info.get("class", ""), "rarity": rarity, "faction": info.get("faction", ""),
                    "nation": info.get("nation", ""), "en": info.get("en", ""), "py": info.get("py", ""), "pyi": info.get("pyi", ""),
                    "avatar": asset(f"images/avatar/{operator_name}-精一.png")}
            # 需要拆分的系列中，高星生成精一/精二两条 ID；低星及待校对项按既有规则保留。
            variants = ["精一", "精二"] if name in source["SPLIT_ELITE_SERIES"] and operator_name not in low_star else ["精一"] if name in source["SPLIT_ELITE_SERIES"] else [None]
            if operator_name == "待校对":
                variants = [None]
            for variant in variants:
                label = operator_name + "·" + variant if variant else operator_name
                pass_id = stable_id("p", name + "|" + label)
                if name + "|" + label in legacy_passes:
                    raise ValueError(f"Duplicate pass identity: {name}|{label}")
                legacy_passes[name + "|" + label] = pass_id
                search_parts = [name, key or "", operator_name, label, info.get("en", ""), info.get("py", ""), info.get("pyi", ""), info.get("class", ""), info.get("faction", ""), *sorted(barcodes)]
                passes.append({"id": pass_id, "operator_id": operator_id, "name": operator_name,
                    "label": label, "variant": variant,
                    "avatar": asset(f"images/avatar/{operator_name}-{variant or '精一'}.png"),
                    "rarity": rarity, "class": info.get("class", ""), "faction": info.get("faction", ""),
                    "en": info.get("en", ""), "py": info.get("py", ""), "pyi": info.get("pyi", ""),
                    "official_unit_price": None if fixed is not None else unit,
                    "search_text": " ".join(part for part in search_parts if part).casefold()})
        series_records.append({"id": series_id, "name": name, "type": kind, "year": entry["year"],
            "box_number": key if supplement else re.fullmatch(r"明日方舟通行认证 (\d+\.0)", name).group(1) if kind == "main" else None,
            "release_date": release_date, "replicate_dates": replicate_dates, "barcodes": sorted(barcodes),
            "image": asset("images/" + name.replace(":", "") + ".jpg"),
            "official_box_price": fixed if fixed is not None else 350 if kind == "main" else len(passes) * unit,
            "passes": passes})
    counts = {"series": len(series_records), "passes": sum(len(s["passes"]) for s in series_records), "operators": len(operator_entries)}
    operators = [operator_entries[name] for name in sorted(operator_entries)]
    if audit["operator_metadata_missing"]:
        warnings.append(f"{len(audit['operator_metadata_missing'])} operators have no exact OPERATOR_INFO match; metadata left empty")
    if audit["missing_assets"]:
        warnings.append(f"{len(audit['missing_assets'])} referenced assets absent from images.zip; URLs left null")
    if audit["unmatched_primary_series"]:
        warnings.append(f"{len(audit['unmatched_primary_series'])} primary series have no safe supplemental box match")
    audit["unmatched_supplement_boxes"] = sorted(set(box_index) - used_boxes)
    audit["counts"] = {**counts, "supplement_boxes": len(boxes), "matched_series": len(audit["matches"]),
                       "assets": len(audit["assets"]), "asset_bytes": sum(a["bytes"] for a in audit["assets"]),
                       "barcodes": sum(len(s["barcodes"]) for s in series_records)}
    audit["license_evidence"] = {"primary": "upstream/LICENSE + upstream/DISCLAIMER.md", "supplement": readme_member,
        "supplement_readme_sha256": digest(uploaded.zip.read(readme_member)),
        "supplement_license_excerpt": "除非另有声明，本仓库其他内容采用知识共享 署名-非商业性使用 4.0 国际（CC BY-NC 4.0）许可协议进行许可。",
        "image_license": "User upload contains no license file; upstream disclaimer excludes game images from MIT"}
    # 目录版本由内容摘要生成，不含 generated_at，保证相同内容得到相同版本。
    version_content = {"source_commit": args.source_commit, "sources": sources, "series": series_records, "operators": operators}
    version = "catalog-" + digest(serialize(version_content, pretty=False))[:16]
    catalog = {"version": version, "generated_at": generated_at, "source_commit": args.source_commit,
               "sources": sources, "series": series_records, "operators": operators, "counts": counts, "warnings": warnings}
    audit["catalog_version"] = version
    legacy = {"catalog_version": version, "identity_separator": "|", "series": legacy_series, "passes": legacy_passes}
    data = serialize(catalog)
    atomic_write(suite / "data/catalog.json", data)
    atomic_write(suite / "data/legacy-map.json", serialize(legacy))
    atomic_write(suite / "web/public/catalog.json", data)
    atomic_write(suite / "docs/data-audit.json", serialize(audit))
    print(json.dumps({"version": version, **audit["counts"], "warnings": len(warnings), "missing_assets": audit["missing_assets"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
