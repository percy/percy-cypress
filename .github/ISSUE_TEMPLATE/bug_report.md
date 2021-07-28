---
name: Bug report
about: Create a report to help us fix the issue
title: ''
labels: ''
assignees: ''
---
<!--
## Reach out to Percy support instead?

If you’re having issues that _aren’t SDK bugs_, it would be best for you to
reach out to support instead: support@percy.io or
https://www.browserstack.com/contact#technical-support
-->

## The problem

Briefly describe the issue you are experiencing (or the feature you want to see
added to Percy). Tell us what you were trying to do and what happened
instead. Remember, this is _not_ a place to ask questions. For that, go to
https://github.com/percy/cli/discussions/new

## Environment

- Node version:
- `@percy/cli` version:
- Version of Percy SDK you’re using:
- If needed, a build or snapshot ID:
- OS version:
- Type of shell command-line [interface]:

## Details

If necessary, describe the problem you have been experiencing in more detail.

## Debug logs

If you are reporting a bug, _always_ include logs! Run a Percy build with
`--verbose` to get the full debug logs. You can also set an environment var
`PERCY_LOGLEVEL=debug` to get debug logs. For example, `percy exec --verbose --
[test command]`.  Please include the full complete test output.

## Code to reproduce issue

Given the nature of testing/environment bugs, it’s best to try and isolate the
issue in a reproducible repo. This will make it much easier for us to diagnose
and fix.
