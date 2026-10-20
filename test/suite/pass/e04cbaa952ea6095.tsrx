#!/usr/bin/env node
using handle = open();
const letters = /[\p{L}--[a-z]]/v;
const active = import.meta.env.platform.web;