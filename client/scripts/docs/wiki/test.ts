import { parseTemplate } from './parser'

/*console.log(parseTemplate(`{{Command

    |game1= ofpr
    |version1= 1.75
    
    |eff= local
    |arg= global
    
    |gr1= Particles |GROUP1=
    
    |descr= Creates a particle effect.
    This command is used to create smoke, fire and similar effects.
    The particles are single polygons with single textures that always face the player.
    
    
    |s1= [[drop]] parameters
    
    |p1= parameters: [[Array]] to format [[ParticleArray]]
    
    | [[Nothing]]
    
    
    |x1= <code>[[drop]] ["cl_basic", "", "Billboard", 1, 1,
            [-3.5 * ([[sin]] ([[direction]] xural)), -3.5 * ([[cos]] ([[direction]] xural)), 0],
            [<nowiki/>[[random]] 0.1, [[random]] 0.1, [[random]] 0.5],
            1, 0.005, 0.0042, 0.7, [0.3,3],
            [[0.5,0.5,0.5,0], [0.7,0.7,0.7,0.5], [0.9,0.9,0.9,0]],
            [0,1,0,1,0,1],
            0.2, 0.2, "", "", xural];</code>
    
    |seealso= [[ParticleArray]], [[setParticleCircle]], [[setParticleParams]], [[setParticleRandom]], [[ParticleTemplates]], [[setParticleClass]], [[particlesQuality]], [[setParticleFire]]
}}`))*/

console.log(parseTemplate(`{{Function|Comments=
    ____________________________________________________________________________________________
    
    | arma2 |Game name=
    
    |1.00|Game version=
    
    |gr1 = Communication Menu |GROUP1=
    ____________________________________________________________________________________________
    
    | <pre>
    /*
            File: fn_createMenu.sqf
    
            Description:
            Create custom commanding menu (with multiple pages if necessary).
    
            Parameter(s):
                    _this select 0 - STRING or ARRAY - Name of menu or [Name, Context sensitive]
                    _this select 1 - STRING - Variable in which will be menu params stored (as variable_0, variable_1, ...)
                    _this select 2 - ARRAY - Array with menu items (can be either [items] or [[items],[itemNames],[itemEnable]] if you want to set custom params (names, enable values))
                    _this select 3 - STRING - Name of submenu which will open when item is activated. Name of selected item is passed to string as %1
                    _this select 4 - STRING - Expression which is executed when item is activated. Name of selected item is passed to string as %1, ID is %2.
                    _this select 5 - ANYTHING (Optional) - params passed to expression. Whole argument is passed as %3
                    _this select 6 - BOOLEAN - False to hide number shortcuts
    
            Returned value(s):
                    True
    
            Example:
              c = ["first","second"]; ["Menu", "b", c, "","hint 'ahoj'"] call BIS_FNC_createmenu; showCommandingMenu "#USER:b_0"
              c = [["firstData","secondData"],["First","Second"]]; ["Menu", "b", c, "","hint (str '%1' + str '%2' + str '%3')"] call BIS_FNC_createmenu;  showCommandingMenu "#USER:b_0";
              see news:g7p3po$gik$1@new-server.localdomain
    */
    </pre><small>''(Placeholder description extracted from the function header by [[BIS_fnc_exportFunctionsToWiki]])''</small> |DESCRIPTION=
    ____________________________________________________________________________________________
    
    | <!-- [] call [[BIS_fnc_createmenu]]; --> |SYNTAX=
    
    |p1= |PARAMETER1=
    
    | |RETURNVALUE=
    ____________________________________________________________________________________________
    
    |x1= <code></code> |EXAMPLE1=
    ____________________________________________________________________________________________
    
    | |SEEALSO=
    
    }}`))