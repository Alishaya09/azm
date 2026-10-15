"""Translate the Qwen tool_call markup to an OpenAI compatible, read-only call."""
import json
import re


def parse_tool_calls(answer, allowed):
    if not allowed:
        return []
    blocks = re.findall(r'<tool_call>\s*(.*?)\s*</tool_call>', answer, re.S)
    if not 1 <= len(blocks) <= 3:
        return []
    calls = []
    for index, block in enumerate(blocks):
        try:
            value = json.loads(block)
        except (ValueError, TypeError):
            return []
        if not isinstance(value, dict) or value.get('name') not in allowed:
            return []
        args = value.get('arguments', {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError:
                return []
        if not isinstance(args, dict) or len(json.dumps(args)) > 4000:
            return []
        calls.append({'id': f'azm_call_{index}', 'type': 'function', 'function': {'name': value['name'], 'arguments': json.dumps(args, ensure_ascii=False)}})
    return calls
