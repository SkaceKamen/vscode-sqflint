# Version 0.9.6
 * Fixed macros in macros not being properly parsed (#41)
 * Fixed `or` not accepting `not` as right argument (#24)

# Version 0.9.5
 * Fixed multi-line macros breaking locations of messages
 * Fixed defines with more than 1 whitespaces being ignored (#40)
 * Fixed some issues with context separation (#37)

# Version 0.9.4
 * Fixed `mission.sqm` scanner not loading logics

# Version 0.9.3
 * Added `mission.sqm` scanner, which will discover objects and markers defined in editor. (only works on debinarized missions)

# Version 0.9.2
 * Added ACE3 functions
 * Fixed issues with multiline macros
 * Fixed issues with macros that could lead to infinite loop
 * Fixed GoTo not working on #include paths

# Version 0.9.1
 * Added new sqf functions
 * Fixed some issues with hpp parser (allowed classnames beginning with numbers, allowed inner array definiton with [], allowed decimal number definition without 0 (ex .5))
 * Fixed local variables not showing in autocomplete

# Version 0.9.0
 * Added context separation, that can detect undefined variables in different contexts in same file (can have false positives, can be disabled)
 * Ignored variables array now accepts wildcards (#31)
 * More robust callable check (#25, #35)

# Version 0.8.8
 * Fixed links in hover docs for functions (#34)
 * Fixed hover docs for some functions and operators
 * Switched order of hover docs to display syntax first (to be in line with other vscode extension)

# Version 0.8.7
 * Fixed issue with empty classes in hpp files (#32)
 * Fixed macro support in hpp files (thanks veteran29)
 * Added support for `#` operator (#30)

# Version 0.8.6
 * `description.ext` files in subfolders of workspace will now be properly loaded
 * Added `discoverDescriptionFiles` options, which allows user to enable/disable automatic searching for `description.ext` files
 * Added `descriptionFiles` option, allowing user to specify list of paths to additional description files
 * cfgFunctions parser now supports docstring in both BIS and CBA formats

# Version 0.8.5
 * Migrated debugger to newer vscode version
 * Added `messageFilter` and `errorFilter` to debugger configuration allowing basic filtering of output

# Version 0.8.4
 * Fixed issue with `with` command (#18)
 * `__FILE__` and `__LINE__` are on longer recognized as variables

# Version 0.8.3
 * Added new commands and functions

# Version 0.8.2
 * `#include` path can now be opened (#15)
 * Fixed incorrect macro expansion (#14)
 * Fixed empty statements causing errors
 * Fixed comments in HPP files missing style

# Version 0.8.1
 * Fixed path normalization in `includePrefixes` (issue #13)
 * Fixed preprocessor not recognizing multiline comments (issue #13)
 * Incorrect path in `#include` now throws warning about invalid paths when `checkPaths` option is enabled

# Version 0.8.0
 * Added `includePrefixes` option, using this option, you can map prefix used in `#include` to different path. For example, you can map `\A3\` to `C:\UnpackedArma\`, so `#include "\A3\hpp.inc"` will be mapped to `#include "C:\UnpackedArma\hpp.inc"`
 * Macros now show their definition in hover

# Version 0.7.9
 * Fixed descriptions for some commands
 * Fixed `params` raising undefined property in some cases
 * Fixed hover not working when file with definition of variable was deleted/moved
 * Fixed `if` sometimes throwing errors in console
 * Fixed wrong error offsets for HPP files
 * Fixed HPP parser using older file contents

# Version 0.7.8
 * Added [basic coloring](http://sqflint.zipek.cz/images/desc_color.png) for EXT/HPP files
 * Added [code completion](http://sqflint.zipek.cz/images/desc_help.png) for description.ext
 * Hovering over variable will now [display its definiton(s)](http://sqflint.zipek.cz/images/variable_hover_def.png)
 * Update hover format to match default [vscode style](http://sqflint.zipek.cz/images/hover_reformat.png)
 * Fixed [hover documentation](http://sqflint.zipek.cz/images/functions_hover.png) for some BIS functions

# Version 0.7.7
 * Removed debug output (sorry)

# Version 0.7.6
 * Fixed HPP parser not working in same cases (switched to different parser generator)

# Version 0.7.5
 * Macros with arguments are now properly handled

# Version 0.7.4
 * `switch` and `try` results can now be assigned to variable
 * Fixed parser not woring at all (don't kill me pls)
 * Fixed empty files throwing errors

# Version 0.7.3
 * Workspace indexing optimization, SQFLint can now parse multiple files in one process, which greatly incerases performance (this means we have language server behind language server, which is sad)
 * Fixed some issues with preprocessor

# Version 0.7.2
 * Fixed more HPP parser issues

# Version 0.7.1
 * Fixed hover not vorking
 * Fixed some HPP parser issues

# Version 0.7.0
 * Added basic description.ext parser, which will try to parse cfgFunctions and load user defined functions (issue #5)
 * Added new functions and operators
 * Fixed double indexing

# Version 0.6.5
 * Variables used before being defined are now correctly marked as undefined
 * Added option to ignore specific variables when checking for definition (`ignoredVariables` option)

# Version 0.6.4
 * Fixed `if` result not being assignable to variable (issue #4)
 * Fixed faulty string being accepted (issue #8)
 * Macros and includes are now parsed and processed, but include only loads preprocessor commands for now (issue #6)
 * Part of the grammar was rewritten to support more complex structures and analytics (assignable `switch` should be in next release)
 * Added new operators / functions

# Version 0.6.3
 * Fixed variables declared in `params` or `for` being suggested with string quotations

# Version 0.6.2
 * Added double indexing to resolve global variables (`indexWorkspaceTwice` option)
 * Added option to exclude files from indexing (`exclude` option)
 * Marcos and includes are now correctly parsed
 * Fixed incorrect operator parsing (issue #3)
 * Fixed incorrect parsing of `try`, `catch` and `throw` (issue #2)

# Version 0.6.1
 * Better variable definition detection (now correctly detects variables in `for` and `params`)
 * Added CBA functions
 * Added [completion](http://sqflint.zipek.cz/images/sqflint-events-autocomplete.png) and [hover info](http://sqflint.zipek.cz/images/sqflint-events-hover.png) for UI/units events

# Version 0.6.0
 * Added global variables to autocompletion
 * Added workspace indexing
 * Added options to: disable warnings, disable workspace indexing
 * Added experimental debugger, which currently just watches for changes in lastest rpt file
 * SQFLint jar is now bundled with extension, so you now only need java installed
 * Actual variable name is now used for warnings and autocompletion (only lowercase version was used previously)
 * Fixed exec error crashing language server

# Version 0.5.5
 * Fixed autocompletion for BIS functions

# Version 0.5.3

 * **Optimization:** Limited number of sqflint calls when writing code
   * previously, sqflint was called on every change, which caused high CPU usage

# Version 0.5.2

 * Some little optimizations
 * Fixed signature help