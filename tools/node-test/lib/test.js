#!/usr/bin/env node
// 
//        Copyright 2010 Johan Dahlberg. All rights reserved.
//
//  Redistribution and use in source and binary forms, with or without
//  modification, are permitted provided that the following conditions
//  are met:
//
//    1. Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//
//    2. Redistributions in binary form must reproduce the above copyright 
//       notice, this list of conditions and the following disclaimer in the 
//       documentation and/or other materials provided with the distribution.
//
//  THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES,
//  INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
//  AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
//  THE AUTHORS OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
//  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
//  TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
//  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
//  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
//  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
//  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//

const print               = require("util").print
    , spawn               = require("child_process").spawn
    , stat                = require("fs").statSync
    , readdir             = require("fs").readdirSync
    , basename            = require("path").basename
    , join                = require("path").join

const VERSION             = "1.0.0";
const USAGE               = "Usage: test.js [options] filepath or dirpath";

const HELP 								= USAGE + "\n" + "\
Options:                                                              \n\
  -h, --help             Show this help                               \n\
  -v, --version          Shows current version                        \n\
  -r, --recursive        Recursive-mode. Selects all test in dirpath  \n\
                         and its subdirectories.                      \n\
    , --usage            Show usage for command                       \n\
    , --silent           Silent-mode.                                 \n\
    , --logstdout        Print's all data sent to test's stdout       \n";
    
function main() {
  var args = process.argv.slice(2);
  var arg = null;
  var paths = [];
  var tests = [];
  var opts = {};
  var longest = 0;
  var errors = 0;
  var failures = 0;
  var passes = 0;
  
  while ((arg = args.shift())) {
    if (arg.substr(0, 2) == "--") {
      opts[arg.substr(2)] = true;
    } else if (arg[0] == "-") {
      opts[arg.substr(1)] = true;
    } else {
      /^(\/|\~|\.)/.test(arg) ? paths.push(arg) : 
                                paths.push(process.cwd() + '/' + arg);
    }
  }
  
  if (!opts.r) {
    opts.r = opts.recursive;
  }

  if (opts.help || opts.h) {
    console.log(HELP);
    return;
  }
  
  paths.forEach(function(path) {
    stat(path).isDirectory() && (tests = tests.concat(files(path, opts.r)));
    stat(path).isFile() && tests.push(path);    
  });

  if (!tests.length || opts.usage) {
    console.log(USAGE);
    return;
  }
  
  if (opts.version || opts.v) {
    console.log(VERSION);
    return;
  }
  
  tests.forEach(function(path) {
    longest = (path.length > longest && path.length) || longest;
  });
  
  function dots(str, l) {
    var result = [];
    var index = (l - str.length) + 3;
    while (index--) {
      result.push(".");
    }
    return result.join("");
  }
  
  function finish() {
    !opts.silent && console.log("Passed: %s, Failed: %s, Errors: %s",
                                passes, failures, errors);

    process.nextTick(function() {
      // process.exit();
    });
  }
  
  function runtests() {
    var s = opts.silent;
    var test = tests.shift();
    var now = new Date().getTime();
    !s && print(test + dots(test, longest));
    
    exports.test(test, opts, [], function(error, failure) {
      var secs = "(" + ((new Date().getTime() - now) / 1000) + " sec)";
      error && ++errors && !s && print("error\n" + error);
      failure && ++failures && !s && print("failed\n" + failure);
      !error && !failure && ++passes && !s && print("ok " + secs + "\n");
      process.nextTick((tests.length && runtests) || finish);
    });
  }
  
  !opts.silent && console.log("Running %s tests", tests.length);
  process.nextTick(runtests);
}

/**
 *  ## test.test(path, [options], [execargs], [callback])
 *
 *  Spawns a new child process and runs specified  `'path'`. The optional 
 *  `'callback'` is called when child process exits. The first argument is set
 *  if an error occured.
 *
 *  Available options:
 *  * logstdout - Prints all data from child's stdout to current process stdout.
 */
exports.test = function() {
  var args = Array.prototype.slice.call(arguments);
  var path = args.shift();
  var opts = !Array.isArray(args[0]) && 
             typeof args[0] !=  "function" ? args.shift() : {};
  var execArgs = Array.isArray(args[0]) ? args.shift() : [];
  var callback = typeof args[0] == "function" ? args.shift() : null;
  var uargs = [path].concat(typeof arguments[1] == "function" ? [] : args);
  var proc = spawn(process.execPath, [path].concat(execArgs || []));
  var err = null;
  
  if (opts.logstdout && !opts.silent) {
    proc.stdout.on("data", function(data) {
      print(data);
    });
  }

  proc.stderr.on("data", function(error) {
    err = error;
  });
  
  proc.on("exit", function(code) {
    callback && callback(null, err || code);
  });
  
  opts.debug && proc.stdout.on("data", function(data) {
    print(data);
  });
  
}

// Get all tests objects form specified directory. 
function files(dirpath, r) {
  var result = [];
  var paths = readdir(dirpath);
  
  paths.forEach(function(path) {
    var p = join(dirpath, path);
    stat(p).isDirectory() && r && (result = result.concat(files(p, r)));
    stat(p).isFile() && /^test/.test(basename(p)) && result.push(p);
  });
  
  return result;
}

// Run in exec mode if executed from 
// command line
process.argv[1] == __filename && main();