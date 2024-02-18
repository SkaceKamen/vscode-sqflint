#define MACRO1 0
#define MACRO2 1

{
	private _heightIndex = if (_isHigh) then { MACRO1 } else { MACRO2 };

	if (_threat select 2 >= 0.75) then {
		(_staticsList#CATEGORY_AA) pushBack _x;
	};
} foreach _statics;