"""Runs server/osrm/motorcycle-id.lua in a real Lua interpreter (lupa) against a stand-in for car.lua, to prove
which ways it drops and that everything else reaches car.lua untouched. It does NOT run OSRM itself: building a
graph from a real extract is a server job (see docs/ROUTING.md, "Check it on the server")."""
import sys
try:
    from lupa import LuaRuntime
except ImportError:
    print('SKIP: pip install lupa'); sys.exit(0)

lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute("""
calls = {}
package.loaded['car'] = {
  setup = function() return { marker = 'car-setup' } end,
  process_node = function() return 'node' end,
  process_turn = function() return 'turn' end,
  process_way = function(profile, way, result, relations) calls[#calls + 1] = way.tags.highway or '?'; result.forward_mode = 1; return 'delegated' end
}
local src = io.open('server/osrm/motorcycle-id.lua'):read('*a')
profile_mod = load(src)()
function mkway(tags) return { tags = tags, get_value_by_key = function(self, k) return self.tags[k] end } end
function run(tags) local before = #calls; local result = { forward_mode = 0 }; profile_mod.process_way({}, mkway(tags), result, {}); return #calls > before, result.forward_mode end
""")
run = lua.globals().run
cases = [
    ({'highway': 'motorway', 'toll': 'yes'}, False, 'toll motorway'),
    ({'highway': 'motorway'}, False, 'motorway without a toll tag'),
    ({'highway': 'motorway_link'}, False, 'motorway slip road'),
    ({'highway': 'trunk', 'toll': 'yes'}, False, 'tolled trunk road'),
    ({'highway': 'primary', 'toll': 'yes'}, False, 'tolled bridge/primary road'),
    ({'highway': 'trunk', 'motorroad': 'yes'}, False, 'motorroad=yes'),
    ({'highway': 'secondary', 'motorcycle': 'no'}, False, 'motorcycle=no'),
    ({'highway': 'primary', 'toll': 'yes', 'toll:motorcycle': 'no'}, True, 'toll road that is free for motorcycles (e.g. a bridge lane)'),
    ({'highway': 'primary'}, True, 'plain primary road'),
    ({'highway': 'trunk'}, True, 'national road tagged trunk (not toll)'),
    ({'highway': 'secondary', 'toll': 'no'}, True, 'toll=no'),
    ({'highway': 'residential'}, True, 'residential street'),
    ({'highway': 'tertiary', 'motorcycle': 'yes'}, True, 'motorcycle=yes'),
]
fails = 0
for tags, delegated, label in cases:
    got, mode = run(lua.table_from(tags))
    good = got == delegated and ((mode == 1) == delegated)
    print(('PASS ' if good else 'FAIL ') + label)
    fails += 0 if good else 1
checks = lua.eval("""function()
  local car = package.loaded['car']
  return profile_mod.setup == car.setup, profile_mod.process_node == car.process_node, profile_mod.process_turn == car.process_turn
end""")()
print('PASS setup / process_node / process_turn are car.lua\'s own' if all(checks) else 'FAIL pass-through functions'); fails += 0 if all(checks) else 1
print(f'\n{len(cases) + 1 - fails} passed, {fails} failed')
sys.exit(1 if fails else 0)
