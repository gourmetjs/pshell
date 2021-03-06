"use strict";

var npath = require("path");
var nspawn = require("child_process").spawn;

function _spawn(exec, args, options) {
  var P = options.Promise || Promise;

  if (options.echoCommand) {
    if (typeof options.echoCommand === "function") {
      if (options.echoCommand(exec, args) === false) {
        return {
          childProcess: null,
          promise: P.resolve(null)
        };
      }
    } else {
      console.log(exec, args.join(" "));
    }
  }

  // Specifying `stdio` skips special stdio handling and handover the option
  // to underlying Node's `spawn` directly.
  var handleStdio;

  if (!options.stdio) {
    handleStdio = true;
    options.stdio = [
      options.inputContent ? "pipe" : "inherit",
      options.captureOutput ? "pipe" : "inherit",
      options.captureError ? "pipe" : "inherit"
    ];
  }

  if (options.rawEnv)
    options.env = options.rawEnv;
  else if (options.env)
    options.env = _env(options.env);

  var child = nspawn(exec, args, options);

  var promise = new P(function(resolve, reject) {
    function _stream(s, format) {
      return new P(function(resolve, reject) {
        var chunks = [];
        s.on("data", function(chunk) {
          chunks.push(chunk);
        }).on("end", function() {
          chunks = Buffer.concat(chunks);
          if (typeof format === "function") {
            chunks = format(chunks);
          } else {
            chunks = chunks.toString();
            if (options.normalizeText) {
              if (typeof options.normalizeText === "function")
                chunks = options.normalizeText(chunks);
              else
                chunks = chunks.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            }
          }
          resolve(chunks);
        }).once("error", function(err) {
          reject(err);
        });
      });
    }

    function _capture() {
      var res = {};
      var promises = [];
      if (options.captureOutput) {
        promises.push(_stream(child.stdout, options.captureOutput).then(function(data) {
          res.stdout = data;
        }));
      }
      if (options.captureError) {
        promises.push(_stream(child.stderr, options.captureError).then(function(data) {
          res.stderr = data;
        }));
      }
      res.promise = P.all(promises);
      return res;
    }

    var capture;

    if (handleStdio) {
      if (options.captureOutput || options.captureError)
        capture = _capture();
      if (options.inputContent)
        child.stdin.end(options.inputContent);
    }

    child.once("exit", function(code, signal) {
      if (!options.ignoreError && (code || signal)) {
        var msg = code ? ("exited with code " + code) : ("was terminated by signal " + signal);
        var err = Error("Process " + child.pid + " " + msg);
        reject(err);
      } else {
        var res = {
          code: code,
          signal: signal,
        };
        if (capture) {
          capture.promise.then(function() {
            res.stdout = capture.stdout;
            res.stderr = capture.stderr;
            resolve(res);
          }).catch(reject);
        } else {
          resolve(res);
        }
      }
    }).once("error", function(err) {
      reject(err);
    });
  });

  return {
    childProcess: child,
    promise: promise
  };
}

function _shell(command, options) {
  var sh, sw, args;

  if (process.platform === "win32") {
    sh = options.shellName || process.env.comspec || "cmd.exe";
    sw = options.shellSwitch || ["/s", "/c"];
    args = sw.concat('"' + command + '"');
    options.windowsVerbatimArguments = true;
  } else {
    sh = options.shellName || "/bin/sh";
    sw = options.shellSwitch || ["-c"];
    args = sw.concat(command);
  }

  return _spawn(sh, args, options);
}

function _assign(assigner, des) {
  var len = arguments.length;
  var idx, src, key, val;

  for (idx = 2; idx < len; idx++) {
    src = arguments[idx];
    for (key in src) {
      if (!src.hasOwnProperty(key))
        continue;
      val = src[key];
      if (assigner)
        assigner(des, key, val);
      else
        des[key] = val;
    }
  }

  return des;
}

function _optionAssigner(des, key, val) {
  if (key === "env" && des[key])
    _assign(null, des[key], val);
  else
    des[key] = val;
}

function _merge() {
  var args = Array.prototype.slice.call(arguments);
  return _assign.apply(null, [_optionAssigner].concat(args));
}

function _envAssigner(des, key, val) {
  function _clean(key) {
    key = key.toLowerCase();
    for (var name in des) {
      if (!des.hasOwnProperty(name))
        continue;
      if (name.toLowerCase() === key)
        delete des[name];
    }
  }

  if (Array.isArray(val))
    val = val.join(npath.delimiter);

  if (process.platform === "win32")
    _clean(key);

  des[key] = val;
}

function _env(env) {
  return _assign(_envAssigner, {}, process.env, env);
}

function _context(baseOptions) {
  function shell(command, options) {
    options = _merge({}, baseOptions, options);
    return _shell(command, options).promise;
  }

  // `spawn(exec, options)` format is not supported
  function spawn(exec, args, options) {
    options = _merge({}, baseOptions, options);
    return _spawn(exec, args || [], options);
  }

  function exec(command, options) {
    options = _merge({}, baseOptions, options);
    return _shell(command, options);
  }

  shell.options = baseOptions = baseOptions || {};
  shell.context = function(options) {
    return _context(_merge({}, baseOptions, options));
  };
  shell.spawn = spawn;
  shell.exec = exec;
  shell.env = _env;

  return shell;
}

module.exports = _context({
  Promise: null,
  echoCommand: true,    // boolean or function
  ignoreError: false,   // boolean
  shellName: null,      // string
  shellSwitch: null,    // null or array of string
  inputContent: null,   // null, Buffer or string
  captureOutput: false, // boolean or function
  captureError: false,  // boolean or function
  normalizeText: true   // boolean or function

  // In addition to the above, Node's `spawn` options are also supported:
  // cwd, env, arg0, stdio, detached, uid, gid
});
