# Version 0.6.4
 * Fixed `if` result not being assignable to variable (issue #4)
 * Fixed faulty string being accepted (issue #8)
 * Macros and includes now properly works (issue #6)
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