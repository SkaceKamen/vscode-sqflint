/*
	Function:
	RSTF_fnc_spawnDefenceEmplacements

	Description:
	Spawns some defence positions, used for PUSH game mode now

	Parameter(s):
	_emplacementsCount - number of emplacements to spawn [Number]
	_center - point to use for spawning [Position]
	_direction - direction of advance of enemy [Number]
	_radius - radius of area to spawn in [Number]
	_sideIndex - side to spawn [Number]
*/

#define STATIC_LOW 0
#define STATIC_HIGH 1
#define CATEGORY_AA 0
#define CATEGORY_AI 1
#define CATEGORY_AT 2

private _emplacementsCount = param [0];
private _center = param [1];
private _direction = param [2];
private _radius = param [3];
private _sideIndex = param [4, SIDE_ENEMY];
private _side = [_sideIndex] call RSTF_fnc_indexSide;

// Fist index - SIZE_LOW/SIZE_HIGH, Second index - CATEGORY_AA/CATEGORY_AI/CATEGORY_AT
private _staticWeapons = [
	[[], [], []],
	[[], [], []]
];
private _availableStaticWeaponTypes = [[], []];

// Names for each weapon type index
private _staticWeaponsNames = [ "AA", "AT", "AI"];

// Contains list of possible emplacement compositions (found in compositions folder)
private _emplacements = [["PushDefense"]] call RSTF_fnc_getEmplacements;

private _statics = (RSTF_VEHICLES select _sideIndex) select RSTF_VEHICLE_STATIC;

// Try to load static weapons from config
{
	private _threat = getArray(configFile >> "cfgVehicles" >> _x >> "threat");
	private _veh = _x createVehicle [0, 0, 100];
	_veh enableSimulation false;
	_veh setPosASL [0, 0, 100];

	private _pos = eyePos(_veh);
	private _bbox = 0 boundingBox _veh;
	private _diameter = _bbox select 2;
	/*
	private _p1 = _bbox select 0;
	private _p2 = _bbox select 1;
	private _maxWidth = abs ((_p2 select 0) - (_p1 select 0));
	private _maxLength = abs ((_p2 select 1) - (_p1 select 1));
	private _maxHeight = abs ((_p2 select 2) - (_p1 select 2));
	*/

	if (_diameter < 4) then {
		private _isHigh = _pos select 2 > 100.75;
		deleteVehicle _veh;
		private _heightIndex = if (_isHigh) then { STATIC_HIGH } else { STATIC_LOW };
		private _staticsList = _staticWeapons#_heightIndex;

		if (_threat select 2 >= 0.75) then {
			(_staticsList#CATEGORY_AA) pushBack _x;
		};
		if (_threat select 1 >= 0.75) then {
			(_staticsList#CATEGORY_AT) pushBack _x;
		};
		if (_threat select 0 >= 0.75) then {
			(_staticsList#CATEGORY_AI) pushBack _x;
		};
	} else {
		diag_log text(format["[RSTF] %1 is too big: %2m", _x, _diameter]);
	};
} foreach _statics;

{
	diag_log text(format["[RSTF] Loaded static weapons %1: %2", _x#0, str(_staticWeapons select (_x#1))]);
} forEach [["LOW", STATIC_LOW], ["HIGH", STATIC_HIGH]];

// Load list of weapon types with at least one item
{
	private _height = _foreachIndex;

	{
		private _category = _foreachIndex;

		if (count(_x) > 0) then {
			(_availableStaticWeaponTypes#_height) pushBack _category;
		};
	} foreach _x;
} foreach _staticWeapons;

// Keep list of spawned defenses so we don't spawn emplacements too close to each other
private _usedPositions = [];

// Spawn emplacements
private _i = 0;
for [{_i = 0}, {_i < _emplacementsCount}, {_i = _i + 1}] do {
	// Pick position
	private _position = [_center, _radius, _direction, _usedPositions] call RSTF_fnc_pickEmplacementPos;

	// Skip if no position was found
	if (count(_position) < 0) exitWith {
		diag_log text("[RSTF] Failed to find suitable defense placement location :(");
		false;
	};

	// Make position 3D
	_position set [2, 0];
	_usedPositions pushBack _position;

	// Create emplacement
	_empType = selectRandom(_emplacements);
	_spawned = [configName(_empType), _position, _direction + 180 - 5 + random(5)] call RSTF_fnc_spawnComposition2;

	if (RSTF_DEBUG) then {
		diag_log text("[RSTF] Spawning defense at " + str(_position));

		_marker = createMarker ["DEFENSE" + str(_position), _position];
		_marker setmarkerShape "ICON";
		_marker setMarkerType "loc_Ruin";
		_marker setMarkerColor (RSTF_SIDES_COLORS select _sideIndex);
		_marker setMarkerText configName(_empType);
	};

	// Replace weapon placeholder with actual weapon
	{
		private _isHighStatic = typeOf(_x) == "O_HMG_01_high_F";
		private _isLowStatic = typeOf(_x) == "I_HMG_02_F";
		private _isStatic = _isHighStatic || _isLowStatic;
		private _description = _x getVariable ["_SPAWN_DESCRIPTION", ""];
		private _isSoldier = typeof(_x) == "Sign_Arrow_Direction_Blue_F";


		if (_isStatic) then {
			private _staticIndex = if (_isHighStatic) then { STATIC_HIGH } else { STATIC_LOW };

			// Pick vehicle class
			private _typeIndex = selectRandom(_availableStaticWeaponTypes#_staticIndex);
			private _weapons = _staticWeapons#_staticIndex;

			if (count(_availableStaticWeaponTypes#_staticIndex) > 0) then {
				_pos = getPosWorld(_x);
				_dir = vectorDir(_x);
				_up = vectorUp(_x);

				// Move out of the way and replace it!
				_x setPos [0,0,1000];
				deleteVehicle(_x);

				// Pick vehicle
				private _vehicle = selectRandom(_weapons select _typeIndex);
				private _vehicleType = _staticWeaponsNames select _typeIndex;

				// Create vehicle
				_group = createGroup _side;

				private _spawned = createVehicle [_vehicle, [0,0,500], [], 0, "CAN_COLLIDE"];
				_spawned enableSimulationGlobal false;
				_spawned setPosWorld _pos;
				_spawned setVectorDirAndUp [_dir, _up];
				_spawned enableSimulationGlobal true;

				createvehiclecrew(_spawned);
				crew(_spawned) joinSilent _group;

				{
					_x setVariable ["SPAWNED_SIDE", side(_group), true];
					_x setVariable ["SPAWNED_SIDE_INDEX", _side, true];
					_x addEventHandler ["Killed", RSTF_fnc_unitKilled];
					[_x, RSTF_CLEAN_INTERVAL] call RSTFGC_fnc_attach;
				} foreach units(_group);

				// In case the static gets destroyed (incorrectly placed), remove it
				[_spawned, crew(_spawned)] spawn {
					params ["_spawned", "_spawnedCrew"];

					sleep 10;
					if (damage _spawned > 0.5) then {
						deleteVehicle _spawned;
						{
							deleteVehicle _x;
						} forEach _spawnedCrew;
					};
				};
			} else {
				diag_log text(format["[RSTF] No suitable static found for class %1, spawning soldier instead", _staticIndex]);

				_isSoldier = true;

				if (_isLowStatic) then {
					_description = "LOW";
				};
			}
		};

		if (_isSoldier) then {
			private _unitClass = _sideIndex call RSTF_fnc_getRandomSoldier;
			private _group = createGroup _side;
			private _unit = _group createUnit [_unitClass, [0,0,500], [], 0, "NONE"];
			[_unit] joinSilent _group;

			_unit setVariable ["SPAWNED_SIDE", side(_group), true];
			_unit setVariable ["SPAWNED_SIDE_INDEX", _sideIndex, true];
			_unit addEventHandler ["Killed", RSTF_fnc_unitKilled];
			[_unit, RSTF_CLEAN_INTERVAL] call RSTFGC_fnc_attach;

			_pos = getPosWorld(_x);
			_dir = vectorDir(_x);
			_up = vectorUp(_x);

			// Move out of the way and replace it!
			_x setPos [0,0,1000];
			deleteVehicle(_x);

			_unit enableSimulationGlobal false;
			_unit setPosWorld _pos;
			_unit setVectorDirAndUp [_dir, _up];
			_unit enableSimulationGlobal true;
			_unit disableAI "MOVE";

			if (_description == "HIGH") then {
				_unit setUnitPos "UP";
			};

			if (_description == "MID") then {
				_unit setUnitPos "MIDDLE";
			};

			if (_description == "LOW") then {
				_unit setUnitPos "DOWN";
			};
		};
	} foreach _spawned;
};