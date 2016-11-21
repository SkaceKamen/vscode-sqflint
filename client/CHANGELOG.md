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