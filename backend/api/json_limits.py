"""限制不受信任 JSON 的嵌套层数，避免解析、编码和合并时耗尽调用栈。"""
MAX_JSON_DEPTH = 64


class JSONDepthError(ValueError):
    pass


def check_json_depth(value):
    pending = [(value, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > MAX_JSON_DEPTH:
            raise JSONDepthError('数据内容过于复杂，暂时无法读取。请检查文件或重新提交。')
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
