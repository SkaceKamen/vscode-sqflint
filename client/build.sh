#!/bin/bash

set -e

if [ -f "sqflint-*.vsix" ]; then
    rm sqflint-*.vsix
fi

pushd ../server
    npm install
    npm run grammar
    npm run compile
popd

npm install
tsc -p ./
cp ../sqflint/dist/SQFLint.jar bin/SQFLint.jar
vsce package