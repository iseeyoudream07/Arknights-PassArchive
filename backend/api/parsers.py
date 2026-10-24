"""公开接口使用受限的 JSON 解析器；仍继承 DRF 的请求大小保护。"""
from rest_framework.exceptions import ParseError
from rest_framework.parsers import JSONParser

from .json_limits import JSONDepthError, check_json_depth


class BoundedJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        try:
            value = super().parse(stream, media_type, parser_context)
            check_json_depth(value)
            return value
        except (RecursionError, JSONDepthError):
            raise ParseError('数据内容过于复杂，暂时无法读取。请检查文件或重新提交。') from None
        except ParseError:
            raise ParseError('无法读取提交的数据，请检查 JSON 格式后重试。') from None
