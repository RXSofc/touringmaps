-- OSRM profile for motorcycle touring in Indonesia: the default CAR profile, minus every road a motorcycle
-- may not use. Toll and motorway roads are not "avoided" or "excluded": they are simply not in the road graph,
-- so no route, alternative or detour can ever touch them. (That is the difference with the public OSRM demo,
-- which ignores the `exclude` parameter.)
--
-- How it is used: put this file next to car.lua (the osrm-backend Docker image keeps both in /opt) and run
--     osrm-extract -p /opt/motorcycle-id.lua java-latest.osm.pbf
-- `require('car')` works because osrm-extract adds the profile's own folder to Lua's package.path.
--
-- Rules (a way matching ANY of them is dropped):
--   toll=yes                      unless toll:motorcycle=no (some bridges are free for motorcycles)
--   highway=motorway|motorway_link
--   motorroad=yes                 limited-access roads, off limits for slow vehicles
--   motorcycle=no                 explicit ban
-- Everything else is handed to car.lua unchanged (access, speeds, oneways, barriers, turn penalties).

local car = require('car')

local M = {}

local function forbidden(way)
  local toll = way:get_value_by_key('toll')
  if toll == 'yes' and way:get_value_by_key('toll:motorcycle') ~= 'no' then return true end
  local highway = way:get_value_by_key('highway')
  if highway == 'motorway' or highway == 'motorway_link' then return true end
  if way:get_value_by_key('motorroad') == 'yes' then return true end
  if way:get_value_by_key('motorcycle') == 'no' then return true end
  return false
end

M.setup = car.setup
M.process_node = car.process_node
M.process_turn = car.process_turn

function M.process_way(profile, way, result, relations)
  if forbidden(way) then return end        -- result keeps its default: inaccessible in both directions
  return car.process_way(profile, way, result, relations)
end

return M
