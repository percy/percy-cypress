#!/bin/bash

currentVersion=$(jq '.version' package.json)
echo "The current version is" $currentVersion
echo "Enter the version you'd like to release:"

read version

npm version $version
git push origin master
git push --tags
npm publish --access=public
