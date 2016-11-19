# vscode-sqflint
Integrates sqflint tool into VS code.

# Prerequisites
You need to have [sqflint](https://github.com/SkaceKamen/sqflint/releases) installed for syntax error checking to work.

Works best with [SQF Language](https://marketplace.visualstudio.com/items?itemName=Armitxes.sqf) extension.

# Changelog

## Version 0.5.6
 * Fixed exec error crashing language server
 * Added global variables to autocompletion

## Version 0.5.5
 * Fixed autocompletion for BIS functions

## Version 0.5.3

 * **Optimization:** Limited number of sqflint calls when writing code
   * previously, sqflint was called on every change, which caused high CPU usage

## Version 0.5.2

 * Some little optimizations
 * Fixed signature help

# Features

Syntax error checking

![Error example](http://sqflint.zipek.cz/images/sqflint-error.png)

Hover support for commands and BIS functions

![Hover example](http://sqflint.zipek.cz/images/sqflint-hover.png)

Signature help for some commands

![Signature example](http://sqflint.zipek.cz/images/sqflint-signature.png)

Autocomplete for commands and BIS functions (including basic description)

![Autocomplete example](http://sqflint.zipek.cz/images/sqflint-autocomplete.png)