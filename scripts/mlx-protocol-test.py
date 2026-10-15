"""Check Qwen tool markup translation without loading model weights."""
from mlx_protocol import parse_tool_calls


allowed = {'read_requests', 'read_inventory', 'read_report'}
call = parse_tool_calls('<tool_call>{"name":"read_inventory","arguments":{"entityId":"UNIT-01"}}</tool_call>', allowed)
assert len(call) == 1
assert call[0]['type'] == 'function' and call[0]['function']['name'] == 'read_inventory'
assert call[0]['function']['arguments'] == '{"entityId": "UNIT-01"}'
assert parse_tool_calls('<tool_call>{"name":"delete_entity","arguments":{}}</tool_call>', allowed) == []
assert parse_tool_calls('<tool_call>{malformed}</tool_call>', allowed) == []
assert parse_tool_calls('<tool_call>{"name":"read_report","arguments":[1]}</tool_call>', allowed) == []
assert parse_tool_calls('<tool_call>{"name":"read_report","arguments":{}}</tool_call>', set()) == []
print('All MLX protocol checks passed')
