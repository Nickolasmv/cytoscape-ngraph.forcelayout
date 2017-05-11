(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}(g.cytoscapeNgraph || (g.cytoscapeNgraph = {})).forcelayout = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
(function (process){
// vim:ts=4:sts=4:sw=4:
/*!
 *
 * Copyright 2009-2012 Kris Kowal under the terms of the MIT
 * license found at http://github.com/kriskowal/q/raw/master/LICENSE
 *
 * With parts by Tyler Close
 * Copyright 2007-2009 Tyler Close under the terms of the MIT X license found
 * at http://www.opensource.org/licenses/mit-license.html
 * Forked at ref_send.js version: 2009-05-11
 *
 * With parts by Mark Miller
 * Copyright (C) 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

(function (definition) {
    "use strict";

    // This file will function properly as a <script> tag, or a module
    // using CommonJS and NodeJS or RequireJS module formats.  In
    // Common/Node/RequireJS, the module exports the Q API and when
    // executed as a simple <script>, it creates a Q global instead.

    // Montage Require
    if (typeof bootstrap === "function") {
        bootstrap("promise", definition);

    // CommonJS
    } else if (typeof exports === "object" && typeof module === "object") {
        module.exports = definition();

    // RequireJS
    } else if (typeof define === "function" && define.amd) {
        define(definition);

    // SES (Secure EcmaScript)
    } else if (typeof ses !== "undefined") {
        if (!ses.ok()) {
            return;
        } else {
            ses.makeQ = definition;
        }

    // <script>
    } else if (typeof window !== "undefined" || typeof self !== "undefined") {
        // Prefer window over self for add-on scripts. Use self for
        // non-windowed contexts.
        var global = typeof window !== "undefined" ? window : self;

        // Get the `window` object, save the previous Q global
        // and initialize Q as a global.
        var previousQ = global.Q;
        global.Q = definition();

        // Add a noConflict function so Q can be removed from the
        // global namespace.
        global.Q.noConflict = function () {
            global.Q = previousQ;
            return this;
        };

    } else {
        throw new Error("This environment was not anticipated by Q. Please file a bug.");
    }

})(function () {
"use strict";

var hasStacks = false;
try {
    throw new Error();
} catch (e) {
    hasStacks = !!e.stack;
}

// All code after this point will be filtered from stack traces reported
// by Q.
var qStartingLine = captureLine();
var qFileName;

// shims

// used for fallback in "allResolved"
var noop = function () {};

// Use the fastest possible means to execute a task in a future turn
// of the event loop.
var nextTick =(function () {
    // linked list of tasks (single, with head node)
    var head = {task: void 0, next: null};
    var tail = head;
    var flushing = false;
    var requestTick = void 0;
    var isNodeJS = false;
    // queue for late tasks, used by unhandled rejection tracking
    var laterQueue = [];

    function flush() {
        /* jshint loopfunc: true */
        var task, domain;

        while (head.next) {
            head = head.next;
            task = head.task;
            head.task = void 0;
            domain = head.domain;

            if (domain) {
                head.domain = void 0;
                domain.enter();
            }
            runSingle(task, domain);

        }
        while (laterQueue.length) {
            task = laterQueue.pop();
            runSingle(task);
        }
        flushing = false;
    }
    // runs a single function in the async queue
    function runSingle(task, domain) {
        try {
            task();

        } catch (e) {
            if (isNodeJS) {
                // In node, uncaught exceptions are considered fatal errors.
                // Re-throw them synchronously to interrupt flushing!

                // Ensure continuation if the uncaught exception is suppressed
                // listening "uncaughtException" events (as domains does).
                // Continue in next event to avoid tick recursion.
                if (domain) {
                    domain.exit();
                }
                setTimeout(flush, 0);
                if (domain) {
                    domain.enter();
                }

                throw e;

            } else {
                // In browsers, uncaught exceptions are not fatal.
                // Re-throw them asynchronously to avoid slow-downs.
                setTimeout(function () {
                    throw e;
                }, 0);
            }
        }

        if (domain) {
            domain.exit();
        }
    }

    nextTick = function (task) {
        tail = tail.next = {
            task: task,
            domain: isNodeJS && process.domain,
            next: null
        };

        if (!flushing) {
            flushing = true;
            requestTick();
        }
    };

    if (typeof process === "object" &&
        process.toString() === "[object process]" && process.nextTick) {
        // Ensure Q is in a real Node environment, with a `process.nextTick`.
        // To see through fake Node environments:
        // * Mocha test runner - exposes a `process` global without a `nextTick`
        // * Browserify - exposes a `process.nexTick` function that uses
        //   `setTimeout`. In this case `setImmediate` is preferred because
        //    it is faster. Browserify's `process.toString()` yields
        //   "[object Object]", while in a real Node environment
        //   `process.nextTick()` yields "[object process]".
        isNodeJS = true;

        requestTick = function () {
            process.nextTick(flush);
        };

    } else if (typeof setImmediate === "function") {
        // In IE10, Node.js 0.9+, or https://github.com/NobleJS/setImmediate
        if (typeof window !== "undefined") {
            requestTick = setImmediate.bind(window, flush);
        } else {
            requestTick = function () {
                setImmediate(flush);
            };
        }

    } else if (typeof MessageChannel !== "undefined") {
        // modern browsers
        // http://www.nonblocking.io/2011/06/windownexttick.html
        var channel = new MessageChannel();
        // At least Safari Version 6.0.5 (8536.30.1) intermittently cannot create
        // working message ports the first time a page loads.
        channel.port1.onmessage = function () {
            requestTick = requestPortTick;
            channel.port1.onmessage = flush;
            flush();
        };
        var requestPortTick = function () {
            // Opera requires us to provide a message payload, regardless of
            // whether we use it.
            channel.port2.postMessage(0);
        };
        requestTick = function () {
            setTimeout(flush, 0);
            requestPortTick();
        };

    } else {
        // old browsers
        requestTick = function () {
            setTimeout(flush, 0);
        };
    }
    // runs a task after all other tasks have been run
    // this is useful for unhandled rejection tracking that needs to happen
    // after all `then`d tasks have been run.
    nextTick.runAfter = function (task) {
        laterQueue.push(task);
        if (!flushing) {
            flushing = true;
            requestTick();
        }
    };
    return nextTick;
})();

// Attempt to make generics safe in the face of downstream
// modifications.
// There is no situation where this is necessary.
// If you need a security guarantee, these primordials need to be
// deeply frozen anyway, and if you don’t need a security guarantee,
// this is just plain paranoid.
// However, this **might** have the nice side-effect of reducing the size of
// the minified code by reducing x.call() to merely x()
// See Mark Miller’s explanation of what this does.
// http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
var call = Function.call;
function uncurryThis(f) {
    return function () {
        return call.apply(f, arguments);
    };
}
// This is equivalent, but slower:
// uncurryThis = Function_bind.bind(Function_bind.call);
// http://jsperf.com/uncurrythis

var array_slice = uncurryThis(Array.prototype.slice);

var array_reduce = uncurryThis(
    Array.prototype.reduce || function (callback, basis) {
        var index = 0,
            length = this.length;
        // concerning the initial value, if one is not provided
        if (arguments.length === 1) {
            // seek to the first value in the array, accounting
            // for the possibility that is is a sparse array
            do {
                if (index in this) {
                    basis = this[index++];
                    break;
                }
                if (++index >= length) {
                    throw new TypeError();
                }
            } while (1);
        }
        // reduce
        for (; index < length; index++) {
            // account for the possibility that the array is sparse
            if (index in this) {
                basis = callback(basis, this[index], index);
            }
        }
        return basis;
    }
);

var array_indexOf = uncurryThis(
    Array.prototype.indexOf || function (value) {
        // not a very good shim, but good enough for our one use of it
        for (var i = 0; i < this.length; i++) {
            if (this[i] === value) {
                return i;
            }
        }
        return -1;
    }
);

var array_map = uncurryThis(
    Array.prototype.map || function (callback, thisp) {
        var self = this;
        var collect = [];
        array_reduce(self, function (undefined, value, index) {
            collect.push(callback.call(thisp, value, index, self));
        }, void 0);
        return collect;
    }
);

var object_create = Object.create || function (prototype) {
    function Type() { }
    Type.prototype = prototype;
    return new Type();
};

var object_hasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);

var object_keys = Object.keys || function (object) {
    var keys = [];
    for (var key in object) {
        if (object_hasOwnProperty(object, key)) {
            keys.push(key);
        }
    }
    return keys;
};

var object_toString = uncurryThis(Object.prototype.toString);

function isObject(value) {
    return value === Object(value);
}

// generator related shims

// FIXME: Remove this function once ES6 generators are in SpiderMonkey.
function isStopIteration(exception) {
    return (
        object_toString(exception) === "[object StopIteration]" ||
        exception instanceof QReturnValue
    );
}

// FIXME: Remove this helper and Q.return once ES6 generators are in
// SpiderMonkey.
var QReturnValue;
if (typeof ReturnValue !== "undefined") {
    QReturnValue = ReturnValue;
} else {
    QReturnValue = function (value) {
        this.value = value;
    };
}

// long stack traces

var STACK_JUMP_SEPARATOR = "From previous event:";

function makeStackTraceLong(error, promise) {
    // If possible, transform the error stack trace by removing Node and Q
    // cruft, then concatenating with the stack trace of `promise`. See #57.
    if (hasStacks &&
        promise.stack &&
        typeof error === "object" &&
        error !== null &&
        error.stack &&
        error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1
    ) {
        var stacks = [];
        for (var p = promise; !!p; p = p.source) {
            if (p.stack) {
                stacks.unshift(p.stack);
            }
        }
        stacks.unshift(error.stack);

        var concatedStacks = stacks.join("\n" + STACK_JUMP_SEPARATOR + "\n");
        error.stack = filterStackString(concatedStacks);
    }
}

function filterStackString(stackString) {
    var lines = stackString.split("\n");
    var desiredLines = [];
    for (var i = 0; i < lines.length; ++i) {
        var line = lines[i];

        if (!isInternalFrame(line) && !isNodeFrame(line) && line) {
            desiredLines.push(line);
        }
    }
    return desiredLines.join("\n");
}

function isNodeFrame(stackLine) {
    return stackLine.indexOf("(module.js:") !== -1 ||
           stackLine.indexOf("(node.js:") !== -1;
}

function getFileNameAndLineNumber(stackLine) {
    // Named functions: "at functionName (filename:lineNumber:columnNumber)"
    // In IE10 function name can have spaces ("Anonymous function") O_o
    var attempt1 = /at .+ \((.+):(\d+):(?:\d+)\)$/.exec(stackLine);
    if (attempt1) {
        return [attempt1[1], Number(attempt1[2])];
    }

    // Anonymous functions: "at filename:lineNumber:columnNumber"
    var attempt2 = /at ([^ ]+):(\d+):(?:\d+)$/.exec(stackLine);
    if (attempt2) {
        return [attempt2[1], Number(attempt2[2])];
    }

    // Firefox style: "function@filename:lineNumber or @filename:lineNumber"
    var attempt3 = /.*@(.+):(\d+)$/.exec(stackLine);
    if (attempt3) {
        return [attempt3[1], Number(attempt3[2])];
    }
}

function isInternalFrame(stackLine) {
    var fileNameAndLineNumber = getFileNameAndLineNumber(stackLine);

    if (!fileNameAndLineNumber) {
        return false;
    }

    var fileName = fileNameAndLineNumber[0];
    var lineNumber = fileNameAndLineNumber[1];

    return fileName === qFileName &&
        lineNumber >= qStartingLine &&
        lineNumber <= qEndingLine;
}

// discover own file name and line number range for filtering stack
// traces
function captureLine() {
    if (!hasStacks) {
        return;
    }

    try {
        throw new Error();
    } catch (e) {
        var lines = e.stack.split("\n");
        var firstLine = lines[0].indexOf("@") > 0 ? lines[1] : lines[2];
        var fileNameAndLineNumber = getFileNameAndLineNumber(firstLine);
        if (!fileNameAndLineNumber) {
            return;
        }

        qFileName = fileNameAndLineNumber[0];
        return fileNameAndLineNumber[1];
    }
}

function deprecate(callback, name, alternative) {
    return function () {
        if (typeof console !== "undefined" &&
            typeof console.warn === "function") {
            console.warn(name + " is deprecated, use " + alternative +
                         " instead.", new Error("").stack);
        }
        return callback.apply(callback, arguments);
    };
}

// end of shims
// beginning of real work

/**
 * Constructs a promise for an immediate reference, passes promises through, or
 * coerces promises from different systems.
 * @param value immediate reference or promise
 */
function Q(value) {
    // If the object is already a Promise, return it directly.  This enables
    // the resolve function to both be used to created references from objects,
    // but to tolerably coerce non-promises to promises.
    if (value instanceof Promise) {
        return value;
    }

    // assimilate thenables
    if (isPromiseAlike(value)) {
        return coerce(value);
    } else {
        return fulfill(value);
    }
}
Q.resolve = Q;

/**
 * Performs a task in a future turn of the event loop.
 * @param {Function} task
 */
Q.nextTick = nextTick;

/**
 * Controls whether or not long stack traces will be on
 */
Q.longStackSupport = false;

// enable long stacks if Q_DEBUG is set
if (typeof process === "object" && process && process.env && process.env.Q_DEBUG) {
    Q.longStackSupport = true;
}

/**
 * Constructs a {promise, resolve, reject} object.
 *
 * `resolve` is a callback to invoke with a more resolved value for the
 * promise. To fulfill the promise, invoke `resolve` with any value that is
 * not a thenable. To reject the promise, invoke `resolve` with a rejected
 * thenable, or invoke `reject` with the reason directly. To resolve the
 * promise to another thenable, thus putting it in the same state, invoke
 * `resolve` with that other thenable.
 */
Q.defer = defer;
function defer() {
    // if "messages" is an "Array", that indicates that the promise has not yet
    // been resolved.  If it is "undefined", it has been resolved.  Each
    // element of the messages array is itself an array of complete arguments to
    // forward to the resolved promise.  We coerce the resolution value to a
    // promise using the `resolve` function because it handles both fully
    // non-thenable values and other thenables gracefully.
    var messages = [], progressListeners = [], resolvedPromise;

    var deferred = object_create(defer.prototype);
    var promise = object_create(Promise.prototype);

    promise.promiseDispatch = function (resolve, op, operands) {
        var args = array_slice(arguments);
        if (messages) {
            messages.push(args);
            if (op === "when" && operands[1]) { // progress operand
                progressListeners.push(operands[1]);
            }
        } else {
            Q.nextTick(function () {
                resolvedPromise.promiseDispatch.apply(resolvedPromise, args);
            });
        }
    };

    // XXX deprecated
    promise.valueOf = function () {
        if (messages) {
            return promise;
        }
        var nearerValue = nearer(resolvedPromise);
        if (isPromise(nearerValue)) {
            resolvedPromise = nearerValue; // shorten chain
        }
        return nearerValue;
    };

    promise.inspect = function () {
        if (!resolvedPromise) {
            return { state: "pending" };
        }
        return resolvedPromise.inspect();
    };

    if (Q.longStackSupport && hasStacks) {
        try {
            throw new Error();
        } catch (e) {
            // NOTE: don't try to use `Error.captureStackTrace` or transfer the
            // accessor around; that causes memory leaks as per GH-111. Just
            // reify the stack trace as a string ASAP.
            //
            // At the same time, cut off the first line; it's always just
            // "[object Promise]\n", as per the `toString`.
            promise.stack = e.stack.substring(e.stack.indexOf("\n") + 1);
        }
    }

    // NOTE: we do the checks for `resolvedPromise` in each method, instead of
    // consolidating them into `become`, since otherwise we'd create new
    // promises with the lines `become(whatever(value))`. See e.g. GH-252.

    function become(newPromise) {
        resolvedPromise = newPromise;
        promise.source = newPromise;

        array_reduce(messages, function (undefined, message) {
            Q.nextTick(function () {
                newPromise.promiseDispatch.apply(newPromise, message);
            });
        }, void 0);

        messages = void 0;
        progressListeners = void 0;
    }

    deferred.promise = promise;
    deferred.resolve = function (value) {
        if (resolvedPromise) {
            return;
        }

        become(Q(value));
    };

    deferred.fulfill = function (value) {
        if (resolvedPromise) {
            return;
        }

        become(fulfill(value));
    };
    deferred.reject = function (reason) {
        if (resolvedPromise) {
            return;
        }

        become(reject(reason));
    };
    deferred.notify = function (progress) {
        if (resolvedPromise) {
            return;
        }

        array_reduce(progressListeners, function (undefined, progressListener) {
            Q.nextTick(function () {
                progressListener(progress);
            });
        }, void 0);
    };

    return deferred;
}

/**
 * Creates a Node-style callback that will resolve or reject the deferred
 * promise.
 * @returns a nodeback
 */
defer.prototype.makeNodeResolver = function () {
    var self = this;
    return function (error, value) {
        if (error) {
            self.reject(error);
        } else if (arguments.length > 2) {
            self.resolve(array_slice(arguments, 1));
        } else {
            self.resolve(value);
        }
    };
};

/**
 * @param resolver {Function} a function that returns nothing and accepts
 * the resolve, reject, and notify functions for a deferred.
 * @returns a promise that may be resolved with the given resolve and reject
 * functions, or rejected by a thrown exception in resolver
 */
Q.Promise = promise; // ES6
Q.promise = promise;
function promise(resolver) {
    if (typeof resolver !== "function") {
        throw new TypeError("resolver must be a function.");
    }
    var deferred = defer();
    try {
        resolver(deferred.resolve, deferred.reject, deferred.notify);
    } catch (reason) {
        deferred.reject(reason);
    }
    return deferred.promise;
}

promise.race = race; // ES6
promise.all = all; // ES6
promise.reject = reject; // ES6
promise.resolve = Q; // ES6

// XXX experimental.  This method is a way to denote that a local value is
// serializable and should be immediately dispatched to a remote upon request,
// instead of passing a reference.
Q.passByCopy = function (object) {
    //freeze(object);
    //passByCopies.set(object, true);
    return object;
};

Promise.prototype.passByCopy = function () {
    //freeze(object);
    //passByCopies.set(object, true);
    return this;
};

/**
 * If two promises eventually fulfill to the same value, promises that value,
 * but otherwise rejects.
 * @param x {Any*}
 * @param y {Any*}
 * @returns {Any*} a promise for x and y if they are the same, but a rejection
 * otherwise.
 *
 */
Q.join = function (x, y) {
    return Q(x).join(y);
};

Promise.prototype.join = function (that) {
    return Q([this, that]).spread(function (x, y) {
        if (x === y) {
            // TODO: "===" should be Object.is or equiv
            return x;
        } else {
            throw new Error("Can't join: not the same: " + x + " " + y);
        }
    });
};

/**
 * Returns a promise for the first of an array of promises to become settled.
 * @param answers {Array[Any*]} promises to race
 * @returns {Any*} the first promise to be settled
 */
Q.race = race;
function race(answerPs) {
    return promise(function (resolve, reject) {
        // Switch to this once we can assume at least ES5
        // answerPs.forEach(function (answerP) {
        //     Q(answerP).then(resolve, reject);
        // });
        // Use this in the meantime
        for (var i = 0, len = answerPs.length; i < len; i++) {
            Q(answerPs[i]).then(resolve, reject);
        }
    });
}

Promise.prototype.race = function () {
    return this.then(Q.race);
};

/**
 * Constructs a Promise with a promise descriptor object and optional fallback
 * function.  The descriptor contains methods like when(rejected), get(name),
 * set(name, value), post(name, args), and delete(name), which all
 * return either a value, a promise for a value, or a rejection.  The fallback
 * accepts the operation name, a resolver, and any further arguments that would
 * have been forwarded to the appropriate method above had a method been
 * provided with the proper name.  The API makes no guarantees about the nature
 * of the returned object, apart from that it is usable whereever promises are
 * bought and sold.
 */
Q.makePromise = Promise;
function Promise(descriptor, fallback, inspect) {
    if (fallback === void 0) {
        fallback = function (op) {
            return reject(new Error(
                "Promise does not support operation: " + op
            ));
        };
    }
    if (inspect === void 0) {
        inspect = function () {
            return {state: "unknown"};
        };
    }

    var promise = object_create(Promise.prototype);

    promise.promiseDispatch = function (resolve, op, args) {
        var result;
        try {
            if (descriptor[op]) {
                result = descriptor[op].apply(promise, args);
            } else {
                result = fallback.call(promise, op, args);
            }
        } catch (exception) {
            result = reject(exception);
        }
        if (resolve) {
            resolve(result);
        }
    };

    promise.inspect = inspect;

    // XXX deprecated `valueOf` and `exception` support
    if (inspect) {
        var inspected = inspect();
        if (inspected.state === "rejected") {
            promise.exception = inspected.reason;
        }

        promise.valueOf = function () {
            var inspected = inspect();
            if (inspected.state === "pending" ||
                inspected.state === "rejected") {
                return promise;
            }
            return inspected.value;
        };
    }

    return promise;
}

Promise.prototype.toString = function () {
    return "[object Promise]";
};

Promise.prototype.then = function (fulfilled, rejected, progressed) {
    var self = this;
    var deferred = defer();
    var done = false;   // ensure the untrusted promise makes at most a
                        // single call to one of the callbacks

    function _fulfilled(value) {
        try {
            return typeof fulfilled === "function" ? fulfilled(value) : value;
        } catch (exception) {
            return reject(exception);
        }
    }

    function _rejected(exception) {
        if (typeof rejected === "function") {
            makeStackTraceLong(exception, self);
            try {
                return rejected(exception);
            } catch (newException) {
                return reject(newException);
            }
        }
        return reject(exception);
    }

    function _progressed(value) {
        return typeof progressed === "function" ? progressed(value) : value;
    }

    Q.nextTick(function () {
        self.promiseDispatch(function (value) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_fulfilled(value));
        }, "when", [function (exception) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_rejected(exception));
        }]);
    });

    // Progress propagator need to be attached in the current tick.
    self.promiseDispatch(void 0, "when", [void 0, function (value) {
        var newValue;
        var threw = false;
        try {
            newValue = _progressed(value);
        } catch (e) {
            threw = true;
            if (Q.onerror) {
                Q.onerror(e);
            } else {
                throw e;
            }
        }

        if (!threw) {
            deferred.notify(newValue);
        }
    }]);

    return deferred.promise;
};

Q.tap = function (promise, callback) {
    return Q(promise).tap(callback);
};

/**
 * Works almost like "finally", but not called for rejections.
 * Original resolution value is passed through callback unaffected.
 * Callback may return a promise that will be awaited for.
 * @param {Function} callback
 * @returns {Q.Promise}
 * @example
 * doSomething()
 *   .then(...)
 *   .tap(console.log)
 *   .then(...);
 */
Promise.prototype.tap = function (callback) {
    callback = Q(callback);

    return this.then(function (value) {
        return callback.fcall(value).thenResolve(value);
    });
};

/**
 * Registers an observer on a promise.
 *
 * Guarantees:
 *
 * 1. that fulfilled and rejected will be called only once.
 * 2. that either the fulfilled callback or the rejected callback will be
 *    called, but not both.
 * 3. that fulfilled and rejected will not be called in this turn.
 *
 * @param value      promise or immediate reference to observe
 * @param fulfilled  function to be called with the fulfilled value
 * @param rejected   function to be called with the rejection exception
 * @param progressed function to be called on any progress notifications
 * @return promise for the return value from the invoked callback
 */
Q.when = when;
function when(value, fulfilled, rejected, progressed) {
    return Q(value).then(fulfilled, rejected, progressed);
}

Promise.prototype.thenResolve = function (value) {
    return this.then(function () { return value; });
};

Q.thenResolve = function (promise, value) {
    return Q(promise).thenResolve(value);
};

Promise.prototype.thenReject = function (reason) {
    return this.then(function () { throw reason; });
};

Q.thenReject = function (promise, reason) {
    return Q(promise).thenReject(reason);
};

/**
 * If an object is not a promise, it is as "near" as possible.
 * If a promise is rejected, it is as "near" as possible too.
 * If it’s a fulfilled promise, the fulfillment value is nearer.
 * If it’s a deferred promise and the deferred has been resolved, the
 * resolution is "nearer".
 * @param object
 * @returns most resolved (nearest) form of the object
 */

// XXX should we re-do this?
Q.nearer = nearer;
function nearer(value) {
    if (isPromise(value)) {
        var inspected = value.inspect();
        if (inspected.state === "fulfilled") {
            return inspected.value;
        }
    }
    return value;
}

/**
 * @returns whether the given object is a promise.
 * Otherwise it is a fulfilled value.
 */
Q.isPromise = isPromise;
function isPromise(object) {
    return object instanceof Promise;
}

Q.isPromiseAlike = isPromiseAlike;
function isPromiseAlike(object) {
    return isObject(object) && typeof object.then === "function";
}

/**
 * @returns whether the given object is a pending promise, meaning not
 * fulfilled or rejected.
 */
Q.isPending = isPending;
function isPending(object) {
    return isPromise(object) && object.inspect().state === "pending";
}

Promise.prototype.isPending = function () {
    return this.inspect().state === "pending";
};

/**
 * @returns whether the given object is a value or fulfilled
 * promise.
 */
Q.isFulfilled = isFulfilled;
function isFulfilled(object) {
    return !isPromise(object) || object.inspect().state === "fulfilled";
}

Promise.prototype.isFulfilled = function () {
    return this.inspect().state === "fulfilled";
};

/**
 * @returns whether the given object is a rejected promise.
 */
Q.isRejected = isRejected;
function isRejected(object) {
    return isPromise(object) && object.inspect().state === "rejected";
}

Promise.prototype.isRejected = function () {
    return this.inspect().state === "rejected";
};

//// BEGIN UNHANDLED REJECTION TRACKING

// This promise library consumes exceptions thrown in handlers so they can be
// handled by a subsequent promise.  The exceptions get added to this array when
// they are created, and removed when they are handled.  Note that in ES6 or
// shimmed environments, this would naturally be a `Set`.
var unhandledReasons = [];
var unhandledRejections = [];
var reportedUnhandledRejections = [];
var trackUnhandledRejections = true;

function resetUnhandledRejections() {
    unhandledReasons.length = 0;
    unhandledRejections.length = 0;

    if (!trackUnhandledRejections) {
        trackUnhandledRejections = true;
    }
}

function trackRejection(promise, reason) {
    if (!trackUnhandledRejections) {
        return;
    }
    if (typeof process === "object" && typeof process.emit === "function") {
        Q.nextTick.runAfter(function () {
            if (array_indexOf(unhandledRejections, promise) !== -1) {
                process.emit("unhandledRejection", reason, promise);
                reportedUnhandledRejections.push(promise);
            }
        });
    }

    unhandledRejections.push(promise);
    if (reason && typeof reason.stack !== "undefined") {
        unhandledReasons.push(reason.stack);
    } else {
        unhandledReasons.push("(no stack) " + reason);
    }
}

function untrackRejection(promise) {
    if (!trackUnhandledRejections) {
        return;
    }

    var at = array_indexOf(unhandledRejections, promise);
    if (at !== -1) {
        if (typeof process === "object" && typeof process.emit === "function") {
            Q.nextTick.runAfter(function () {
                var atReport = array_indexOf(reportedUnhandledRejections, promise);
                if (atReport !== -1) {
                    process.emit("rejectionHandled", unhandledReasons[at], promise);
                    reportedUnhandledRejections.splice(atReport, 1);
                }
            });
        }
        unhandledRejections.splice(at, 1);
        unhandledReasons.splice(at, 1);
    }
}

Q.resetUnhandledRejections = resetUnhandledRejections;

Q.getUnhandledReasons = function () {
    // Make a copy so that consumers can't interfere with our internal state.
    return unhandledReasons.slice();
};

Q.stopUnhandledRejectionTracking = function () {
    resetUnhandledRejections();
    trackUnhandledRejections = false;
};

resetUnhandledRejections();

//// END UNHANDLED REJECTION TRACKING

/**
 * Constructs a rejected promise.
 * @param reason value describing the failure
 */
Q.reject = reject;
function reject(reason) {
    var rejection = Promise({
        "when": function (rejected) {
            // note that the error has been handled
            if (rejected) {
                untrackRejection(this);
            }
            return rejected ? rejected(reason) : this;
        }
    }, function fallback() {
        return this;
    }, function inspect() {
        return { state: "rejected", reason: reason };
    });

    // Note that the reason has not been handled.
    trackRejection(rejection, reason);

    return rejection;
}

/**
 * Constructs a fulfilled promise for an immediate reference.
 * @param value immediate reference
 */
Q.fulfill = fulfill;
function fulfill(value) {
    return Promise({
        "when": function () {
            return value;
        },
        "get": function (name) {
            return value[name];
        },
        "set": function (name, rhs) {
            value[name] = rhs;
        },
        "delete": function (name) {
            delete value[name];
        },
        "post": function (name, args) {
            // Mark Miller proposes that post with no name should apply a
            // promised function.
            if (name === null || name === void 0) {
                return value.apply(void 0, args);
            } else {
                return value[name].apply(value, args);
            }
        },
        "apply": function (thisp, args) {
            return value.apply(thisp, args);
        },
        "keys": function () {
            return object_keys(value);
        }
    }, void 0, function inspect() {
        return { state: "fulfilled", value: value };
    });
}

/**
 * Converts thenables to Q promises.
 * @param promise thenable promise
 * @returns a Q promise
 */
function coerce(promise) {
    var deferred = defer();
    Q.nextTick(function () {
        try {
            promise.then(deferred.resolve, deferred.reject, deferred.notify);
        } catch (exception) {
            deferred.reject(exception);
        }
    });
    return deferred.promise;
}

/**
 * Annotates an object such that it will never be
 * transferred away from this process over any promise
 * communication channel.
 * @param object
 * @returns promise a wrapping of that object that
 * additionally responds to the "isDef" message
 * without a rejection.
 */
Q.master = master;
function master(object) {
    return Promise({
        "isDef": function () {}
    }, function fallback(op, args) {
        return dispatch(object, op, args);
    }, function () {
        return Q(object).inspect();
    });
}

/**
 * Spreads the values of a promised array of arguments into the
 * fulfillment callback.
 * @param fulfilled callback that receives variadic arguments from the
 * promised array
 * @param rejected callback that receives the exception if the promise
 * is rejected.
 * @returns a promise for the return value or thrown exception of
 * either callback.
 */
Q.spread = spread;
function spread(value, fulfilled, rejected) {
    return Q(value).spread(fulfilled, rejected);
}

Promise.prototype.spread = function (fulfilled, rejected) {
    return this.all().then(function (array) {
        return fulfilled.apply(void 0, array);
    }, rejected);
};

/**
 * The async function is a decorator for generator functions, turning
 * them into asynchronous generators.  Although generators are only part
 * of the newest ECMAScript 6 drafts, this code does not cause syntax
 * errors in older engines.  This code should continue to work and will
 * in fact improve over time as the language improves.
 *
 * ES6 generators are currently part of V8 version 3.19 with the
 * --harmony-generators runtime flag enabled.  SpiderMonkey has had them
 * for longer, but under an older Python-inspired form.  This function
 * works on both kinds of generators.
 *
 * Decorates a generator function such that:
 *  - it may yield promises
 *  - execution will continue when that promise is fulfilled
 *  - the value of the yield expression will be the fulfilled value
 *  - it returns a promise for the return value (when the generator
 *    stops iterating)
 *  - the decorated function returns a promise for the return value
 *    of the generator or the first rejected promise among those
 *    yielded.
 *  - if an error is thrown in the generator, it propagates through
 *    every following yield until it is caught, or until it escapes
 *    the generator function altogether, and is translated into a
 *    rejection for the promise returned by the decorated generator.
 */
Q.async = async;
function async(makeGenerator) {
    return function () {
        // when verb is "send", arg is a value
        // when verb is "throw", arg is an exception
        function continuer(verb, arg) {
            var result;

            // Until V8 3.19 / Chromium 29 is released, SpiderMonkey is the only
            // engine that has a deployed base of browsers that support generators.
            // However, SM's generators use the Python-inspired semantics of
            // outdated ES6 drafts.  We would like to support ES6, but we'd also
            // like to make it possible to use generators in deployed browsers, so
            // we also support Python-style generators.  At some point we can remove
            // this block.

            if (typeof StopIteration === "undefined") {
                // ES6 Generators
                try {
                    result = generator[verb](arg);
                } catch (exception) {
                    return reject(exception);
                }
                if (result.done) {
                    return Q(result.value);
                } else {
                    return when(result.value, callback, errback);
                }
            } else {
                // SpiderMonkey Generators
                // FIXME: Remove this case when SM does ES6 generators.
                try {
                    result = generator[verb](arg);
                } catch (exception) {
                    if (isStopIteration(exception)) {
                        return Q(exception.value);
                    } else {
                        return reject(exception);
                    }
                }
                return when(result, callback, errback);
            }
        }
        var generator = makeGenerator.apply(this, arguments);
        var callback = continuer.bind(continuer, "next");
        var errback = continuer.bind(continuer, "throw");
        return callback();
    };
}

/**
 * The spawn function is a small wrapper around async that immediately
 * calls the generator and also ends the promise chain, so that any
 * unhandled errors are thrown instead of forwarded to the error
 * handler. This is useful because it's extremely common to run
 * generators at the top-level to work with libraries.
 */
Q.spawn = spawn;
function spawn(makeGenerator) {
    Q.done(Q.async(makeGenerator)());
}

// FIXME: Remove this interface once ES6 generators are in SpiderMonkey.
/**
 * Throws a ReturnValue exception to stop an asynchronous generator.
 *
 * This interface is a stop-gap measure to support generator return
 * values in older Firefox/SpiderMonkey.  In browsers that support ES6
 * generators like Chromium 29, just use "return" in your generator
 * functions.
 *
 * @param value the return value for the surrounding generator
 * @throws ReturnValue exception with the value.
 * @example
 * // ES6 style
 * Q.async(function* () {
 *      var foo = yield getFooPromise();
 *      var bar = yield getBarPromise();
 *      return foo + bar;
 * })
 * // Older SpiderMonkey style
 * Q.async(function () {
 *      var foo = yield getFooPromise();
 *      var bar = yield getBarPromise();
 *      Q.return(foo + bar);
 * })
 */
Q["return"] = _return;
function _return(value) {
    throw new QReturnValue(value);
}

/**
 * The promised function decorator ensures that any promise arguments
 * are settled and passed as values (`this` is also settled and passed
 * as a value).  It will also ensure that the result of a function is
 * always a promise.
 *
 * @example
 * var add = Q.promised(function (a, b) {
 *     return a + b;
 * });
 * add(Q(a), Q(B));
 *
 * @param {function} callback The function to decorate
 * @returns {function} a function that has been decorated.
 */
Q.promised = promised;
function promised(callback) {
    return function () {
        return spread([this, all(arguments)], function (self, args) {
            return callback.apply(self, args);
        });
    };
}

/**
 * sends a message to a value in a future turn
 * @param object* the recipient
 * @param op the name of the message operation, e.g., "when",
 * @param args further arguments to be forwarded to the operation
 * @returns result {Promise} a promise for the result of the operation
 */
Q.dispatch = dispatch;
function dispatch(object, op, args) {
    return Q(object).dispatch(op, args);
}

Promise.prototype.dispatch = function (op, args) {
    var self = this;
    var deferred = defer();
    Q.nextTick(function () {
        self.promiseDispatch(deferred.resolve, op, args);
    });
    return deferred.promise;
};

/**
 * Gets the value of a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to get
 * @return promise for the property value
 */
Q.get = function (object, key) {
    return Q(object).dispatch("get", [key]);
};

Promise.prototype.get = function (key) {
    return this.dispatch("get", [key]);
};

/**
 * Sets the value of a property in a future turn.
 * @param object    promise or immediate reference for object object
 * @param name      name of property to set
 * @param value     new value of property
 * @return promise for the return value
 */
Q.set = function (object, key, value) {
    return Q(object).dispatch("set", [key, value]);
};

Promise.prototype.set = function (key, value) {
    return this.dispatch("set", [key, value]);
};

/**
 * Deletes a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to delete
 * @return promise for the return value
 */
Q.del = // XXX legacy
Q["delete"] = function (object, key) {
    return Q(object).dispatch("delete", [key]);
};

Promise.prototype.del = // XXX legacy
Promise.prototype["delete"] = function (key) {
    return this.dispatch("delete", [key]);
};

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param value     a value to post, typically an array of
 *                  invocation arguments for promises that
 *                  are ultimately backed with `resolve` values,
 *                  as opposed to those backed with URLs
 *                  wherein the posted value can be any
 *                  JSON serializable object.
 * @return promise for the return value
 */
// bound locally because it is used by other methods
Q.mapply = // XXX As proposed by "Redsandro"
Q.post = function (object, name, args) {
    return Q(object).dispatch("post", [name, args]);
};

Promise.prototype.mapply = // XXX As proposed by "Redsandro"
Promise.prototype.post = function (name, args) {
    return this.dispatch("post", [name, args]);
};

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param ...args   array of invocation arguments
 * @return promise for the return value
 */
Q.send = // XXX Mark Miller's proposed parlance
Q.mcall = // XXX As proposed by "Redsandro"
Q.invoke = function (object, name /*...args*/) {
    return Q(object).dispatch("post", [name, array_slice(arguments, 2)]);
};

Promise.prototype.send = // XXX Mark Miller's proposed parlance
Promise.prototype.mcall = // XXX As proposed by "Redsandro"
Promise.prototype.invoke = function (name /*...args*/) {
    return this.dispatch("post", [name, array_slice(arguments, 1)]);
};

/**
 * Applies the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param args      array of application arguments
 */
Q.fapply = function (object, args) {
    return Q(object).dispatch("apply", [void 0, args]);
};

Promise.prototype.fapply = function (args) {
    return this.dispatch("apply", [void 0, args]);
};

/**
 * Calls the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
Q["try"] =
Q.fcall = function (object /* ...args*/) {
    return Q(object).dispatch("apply", [void 0, array_slice(arguments, 1)]);
};

Promise.prototype.fcall = function (/*...args*/) {
    return this.dispatch("apply", [void 0, array_slice(arguments)]);
};

/**
 * Binds the promised function, transforming return values into a fulfilled
 * promise and thrown errors into a rejected one.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
Q.fbind = function (object /*...args*/) {
    var promise = Q(object);
    var args = array_slice(arguments, 1);
    return function fbound() {
        return promise.dispatch("apply", [
            this,
            args.concat(array_slice(arguments))
        ]);
    };
};
Promise.prototype.fbind = function (/*...args*/) {
    var promise = this;
    var args = array_slice(arguments);
    return function fbound() {
        return promise.dispatch("apply", [
            this,
            args.concat(array_slice(arguments))
        ]);
    };
};

/**
 * Requests the names of the owned properties of a promised
 * object in a future turn.
 * @param object    promise or immediate reference for target object
 * @return promise for the keys of the eventually settled object
 */
Q.keys = function (object) {
    return Q(object).dispatch("keys", []);
};

Promise.prototype.keys = function () {
    return this.dispatch("keys", []);
};

/**
 * Turns an array of promises into a promise for an array.  If any of
 * the promises gets rejected, the whole array is rejected immediately.
 * @param {Array*} an array (or promise for an array) of values (or
 * promises for values)
 * @returns a promise for an array of the corresponding values
 */
// By Mark Miller
// http://wiki.ecmascript.org/doku.php?id=strawman:concurrency&rev=1308776521#allfulfilled
Q.all = all;
function all(promises) {
    return when(promises, function (promises) {
        var pendingCount = 0;
        var deferred = defer();
        array_reduce(promises, function (undefined, promise, index) {
            var snapshot;
            if (
                isPromise(promise) &&
                (snapshot = promise.inspect()).state === "fulfilled"
            ) {
                promises[index] = snapshot.value;
            } else {
                ++pendingCount;
                when(
                    promise,
                    function (value) {
                        promises[index] = value;
                        if (--pendingCount === 0) {
                            deferred.resolve(promises);
                        }
                    },
                    deferred.reject,
                    function (progress) {
                        deferred.notify({ index: index, value: progress });
                    }
                );
            }
        }, void 0);
        if (pendingCount === 0) {
            deferred.resolve(promises);
        }
        return deferred.promise;
    });
}

Promise.prototype.all = function () {
    return all(this);
};

/**
 * Returns the first resolved promise of an array. Prior rejected promises are
 * ignored.  Rejects only if all promises are rejected.
 * @param {Array*} an array containing values or promises for values
 * @returns a promise fulfilled with the value of the first resolved promise,
 * or a rejected promise if all promises are rejected.
 */
Q.any = any;

function any(promises) {
    if (promises.length === 0) {
        return Q.resolve();
    }

    var deferred = Q.defer();
    var pendingCount = 0;
    array_reduce(promises, function (prev, current, index) {
        var promise = promises[index];

        pendingCount++;

        when(promise, onFulfilled, onRejected, onProgress);
        function onFulfilled(result) {
            deferred.resolve(result);
        }
        function onRejected() {
            pendingCount--;
            if (pendingCount === 0) {
                deferred.reject(new Error(
                    "Can't get fulfillment value from any promise, all " +
                    "promises were rejected."
                ));
            }
        }
        function onProgress(progress) {
            deferred.notify({
                index: index,
                value: progress
            });
        }
    }, undefined);

    return deferred.promise;
}

Promise.prototype.any = function () {
    return any(this);
};

/**
 * Waits for all promises to be settled, either fulfilled or
 * rejected.  This is distinct from `all` since that would stop
 * waiting at the first rejection.  The promise returned by
 * `allResolved` will never be rejected.
 * @param promises a promise for an array (or an array) of promises
 * (or values)
 * @return a promise for an array of promises
 */
Q.allResolved = deprecate(allResolved, "allResolved", "allSettled");
function allResolved(promises) {
    return when(promises, function (promises) {
        promises = array_map(promises, Q);
        return when(all(array_map(promises, function (promise) {
            return when(promise, noop, noop);
        })), function () {
            return promises;
        });
    });
}

Promise.prototype.allResolved = function () {
    return allResolved(this);
};

/**
 * @see Promise#allSettled
 */
Q.allSettled = allSettled;
function allSettled(promises) {
    return Q(promises).allSettled();
}

/**
 * Turns an array of promises into a promise for an array of their states (as
 * returned by `inspect`) when they have all settled.
 * @param {Array[Any*]} values an array (or promise for an array) of values (or
 * promises for values)
 * @returns {Array[State]} an array of states for the respective values.
 */
Promise.prototype.allSettled = function () {
    return this.then(function (promises) {
        return all(array_map(promises, function (promise) {
            promise = Q(promise);
            function regardless() {
                return promise.inspect();
            }
            return promise.then(regardless, regardless);
        }));
    });
};

/**
 * Captures the failure of a promise, giving an oportunity to recover
 * with a callback.  If the given promise is fulfilled, the returned
 * promise is fulfilled.
 * @param {Any*} promise for something
 * @param {Function} callback to fulfill the returned promise if the
 * given promise is rejected
 * @returns a promise for the return value of the callback
 */
Q.fail = // XXX legacy
Q["catch"] = function (object, rejected) {
    return Q(object).then(void 0, rejected);
};

Promise.prototype.fail = // XXX legacy
Promise.prototype["catch"] = function (rejected) {
    return this.then(void 0, rejected);
};

/**
 * Attaches a listener that can respond to progress notifications from a
 * promise's originating deferred. This listener receives the exact arguments
 * passed to ``deferred.notify``.
 * @param {Any*} promise for something
 * @param {Function} callback to receive any progress notifications
 * @returns the given promise, unchanged
 */
Q.progress = progress;
function progress(object, progressed) {
    return Q(object).then(void 0, void 0, progressed);
}

Promise.prototype.progress = function (progressed) {
    return this.then(void 0, void 0, progressed);
};

/**
 * Provides an opportunity to observe the settling of a promise,
 * regardless of whether the promise is fulfilled or rejected.  Forwards
 * the resolution to the returned promise when the callback is done.
 * The callback can return a promise to defer completion.
 * @param {Any*} promise
 * @param {Function} callback to observe the resolution of the given
 * promise, takes no arguments.
 * @returns a promise for the resolution of the given promise when
 * ``fin`` is done.
 */
Q.fin = // XXX legacy
Q["finally"] = function (object, callback) {
    return Q(object)["finally"](callback);
};

Promise.prototype.fin = // XXX legacy
Promise.prototype["finally"] = function (callback) {
    callback = Q(callback);
    return this.then(function (value) {
        return callback.fcall().then(function () {
            return value;
        });
    }, function (reason) {
        // TODO attempt to recycle the rejection with "this".
        return callback.fcall().then(function () {
            throw reason;
        });
    });
};

/**
 * Terminates a chain of promises, forcing rejections to be
 * thrown as exceptions.
 * @param {Any*} promise at the end of a chain of promises
 * @returns nothing
 */
Q.done = function (object, fulfilled, rejected, progress) {
    return Q(object).done(fulfilled, rejected, progress);
};

Promise.prototype.done = function (fulfilled, rejected, progress) {
    var onUnhandledError = function (error) {
        // forward to a future turn so that ``when``
        // does not catch it and turn it into a rejection.
        Q.nextTick(function () {
            makeStackTraceLong(error, promise);
            if (Q.onerror) {
                Q.onerror(error);
            } else {
                throw error;
            }
        });
    };

    // Avoid unnecessary `nextTick`ing via an unnecessary `when`.
    var promise = fulfilled || rejected || progress ?
        this.then(fulfilled, rejected, progress) :
        this;

    if (typeof process === "object" && process && process.domain) {
        onUnhandledError = process.domain.bind(onUnhandledError);
    }

    promise.then(void 0, onUnhandledError);
};

/**
 * Causes a promise to be rejected if it does not get fulfilled before
 * some milliseconds time out.
 * @param {Any*} promise
 * @param {Number} milliseconds timeout
 * @param {Any*} custom error message or Error object (optional)
 * @returns a promise for the resolution of the given promise if it is
 * fulfilled before the timeout, otherwise rejected.
 */
Q.timeout = function (object, ms, error) {
    return Q(object).timeout(ms, error);
};

Promise.prototype.timeout = function (ms, error) {
    var deferred = defer();
    var timeoutId = setTimeout(function () {
        if (!error || "string" === typeof error) {
            error = new Error(error || "Timed out after " + ms + " ms");
            error.code = "ETIMEDOUT";
        }
        deferred.reject(error);
    }, ms);

    this.then(function (value) {
        clearTimeout(timeoutId);
        deferred.resolve(value);
    }, function (exception) {
        clearTimeout(timeoutId);
        deferred.reject(exception);
    }, deferred.notify);

    return deferred.promise;
};

/**
 * Returns a promise for the given value (or promised value), some
 * milliseconds after it resolved. Passes rejections immediately.
 * @param {Any*} promise
 * @param {Number} milliseconds
 * @returns a promise for the resolution of the given promise after milliseconds
 * time has elapsed since the resolution of the given promise.
 * If the given promise rejects, that is passed immediately.
 */
Q.delay = function (object, timeout) {
    if (timeout === void 0) {
        timeout = object;
        object = void 0;
    }
    return Q(object).delay(timeout);
};

Promise.prototype.delay = function (timeout) {
    return this.then(function (value) {
        var deferred = defer();
        setTimeout(function () {
            deferred.resolve(value);
        }, timeout);
        return deferred.promise;
    });
};

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided as an array, and returns a promise.
 *
 *      Q.nfapply(FS.readFile, [__filename])
 *      .then(function (content) {
 *      })
 *
 */
Q.nfapply = function (callback, args) {
    return Q(callback).nfapply(args);
};

Promise.prototype.nfapply = function (args) {
    var deferred = defer();
    var nodeArgs = array_slice(args);
    nodeArgs.push(deferred.makeNodeResolver());
    this.fapply(nodeArgs).fail(deferred.reject);
    return deferred.promise;
};

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided individually, and returns a promise.
 * @example
 * Q.nfcall(FS.readFile, __filename)
 * .then(function (content) {
 * })
 *
 */
Q.nfcall = function (callback /*...args*/) {
    var args = array_slice(arguments, 1);
    return Q(callback).nfapply(args);
};

Promise.prototype.nfcall = function (/*...args*/) {
    var nodeArgs = array_slice(arguments);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    this.fapply(nodeArgs).fail(deferred.reject);
    return deferred.promise;
};

/**
 * Wraps a NodeJS continuation passing function and returns an equivalent
 * version that returns a promise.
 * @example
 * Q.nfbind(FS.readFile, __filename)("utf-8")
 * .then(console.log)
 * .done()
 */
Q.nfbind =
Q.denodeify = function (callback /*...args*/) {
    var baseArgs = array_slice(arguments, 1);
    return function () {
        var nodeArgs = baseArgs.concat(array_slice(arguments));
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        Q(callback).fapply(nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
};

Promise.prototype.nfbind =
Promise.prototype.denodeify = function (/*...args*/) {
    var args = array_slice(arguments);
    args.unshift(this);
    return Q.denodeify.apply(void 0, args);
};

Q.nbind = function (callback, thisp /*...args*/) {
    var baseArgs = array_slice(arguments, 2);
    return function () {
        var nodeArgs = baseArgs.concat(array_slice(arguments));
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        function bound() {
            return callback.apply(thisp, arguments);
        }
        Q(bound).fapply(nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
};

Promise.prototype.nbind = function (/*thisp, ...args*/) {
    var args = array_slice(arguments, 0);
    args.unshift(this);
    return Q.nbind.apply(void 0, args);
};

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback with a given array of arguments, plus a provided callback.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param {Array} args arguments to pass to the method; the callback
 * will be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
Q.nmapply = // XXX As proposed by "Redsandro"
Q.npost = function (object, name, args) {
    return Q(object).npost(name, args);
};

Promise.prototype.nmapply = // XXX As proposed by "Redsandro"
Promise.prototype.npost = function (name, args) {
    var nodeArgs = array_slice(args || []);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    this.dispatch("post", [name, nodeArgs]).fail(deferred.reject);
    return deferred.promise;
};

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback, forwarding the given variadic arguments, plus a provided
 * callback argument.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param ...args arguments to pass to the method; the callback will
 * be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
Q.nsend = // XXX Based on Mark Miller's proposed "send"
Q.nmcall = // XXX Based on "Redsandro's" proposal
Q.ninvoke = function (object, name /*...args*/) {
    var nodeArgs = array_slice(arguments, 2);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    Q(object).dispatch("post", [name, nodeArgs]).fail(deferred.reject);
    return deferred.promise;
};

Promise.prototype.nsend = // XXX Based on Mark Miller's proposed "send"
Promise.prototype.nmcall = // XXX Based on "Redsandro's" proposal
Promise.prototype.ninvoke = function (name /*...args*/) {
    var nodeArgs = array_slice(arguments, 1);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    this.dispatch("post", [name, nodeArgs]).fail(deferred.reject);
    return deferred.promise;
};

/**
 * If a function would like to support both Node continuation-passing-style and
 * promise-returning-style, it can end its internal promise chain with
 * `nodeify(nodeback)`, forwarding the optional nodeback argument.  If the user
 * elects to use a nodeback, the result will be sent there.  If they do not
 * pass a nodeback, they will receive the result promise.
 * @param object a result (or a promise for a result)
 * @param {Function} nodeback a Node.js-style callback
 * @returns either the promise or nothing
 */
Q.nodeify = nodeify;
function nodeify(object, nodeback) {
    return Q(object).nodeify(nodeback);
}

Promise.prototype.nodeify = function (nodeback) {
    if (nodeback) {
        this.then(function (value) {
            Q.nextTick(function () {
                nodeback(null, value);
            });
        }, function (error) {
            Q.nextTick(function () {
                nodeback(error);
            });
        });
    } else {
        return this;
    }
};

Q.noConflict = function() {
    throw new Error("Q.noConflict only works when Q is used as a global");
};

// All code before this point will be filtered from stack traces.
var qEndingLine = captureLine();

return Q;

});

}).call(this,_dereq_('_process'))

},{"_process":38}],2:[function(_dereq_,module,exports){
var work = _dereq_('webworkify');
var tojson = _dereq_('ngraph.tojson');
var eventify = _dereq_('ngraph.events');

var createLayout = _dereq_('./lib/createLayout.js');
var validateOptions = _dereq_('./options.js');
var messageKind = _dereq_('./lib/messages.js');

module.exports = createAsyncLayout;

function createAsyncLayout(graph, options) {
  options = validateOptions(options);

  var assignPosition = options.is3d ? assignPosition3d : assignPosition2d;

  var pendingInitialization = false;
  var initRequestSent = false;
  var systemStable = false;
  var graphRect;
  var pinStatus = Object.create(null);
  var linkPositions;

  // Since this is fairly common message, there is no need to recreate it every time:
  var stepMessage = { kind: messageKind.step };

  var positions = Object.create(null);

  var layoutWorker = work(_dereq_('./lib/layoutWorker.js'));
  layoutWorker.addEventListener('message', handleMessageFromWorker);

  initWorker();
  initPositions();

  var api = {
    /**
     * Request to perform one iteration of force layout. The request is
     * forwarded to web worker
     *
     * @returns {boolean} true if system is considered stable; false otherwise.
     */
    step: asyncStep,

    /**
     * Gets the last known position of a given node by its identifier.
     *
     * @param {string} nodeId identifier of a node in question.
     * @returns {object} {x: number, y: number, z: number} coordinates of a node.
     */
    getNodePosition: getNodePosition,

    /**
     * Gets the last known position of a given link by its identifier.
     *
     * @param {string} linkId identifier of a link in question.
     * @returns {Object} Link position by link id
     * @returns {Object.from} {x, y} coordinates of link start
     * @returns {Object.to} {x, y} coordinates of link end
     */
    getLinkPosition: getLinkPosition,

    /**
     * Requests layout algorithm to pin/unpin node to its current position
     * Pinned nodes should not be affected by layout algorithm and always
     * remain at their position
     *
     * @param {object} node graph node that needs to be pinned
     * @param {boolean} isPinned status of the node.
     */
    pinNode: asyncPinNode,

    /**
     * Sets position of a node to a given coordinates
     * @param {string} nodeId node identifier
     * @param {number} x position of a node
     * @param {number} y position of a node
     * @param {number=} z position of node (only if 3d layout)
     */
    setNodePosition: asyncNodePosition,

    /**
     * Gets rectangle (or a box) that bounds the graph
     */
    getGraphRect: getGraphRect,

    /**
     * Returns true if node is currently pinned (i.e. not moved by layout);
     * False otherwise.
     */
    isNodePinned: isNodePinned
  };

  eventify(api);

  return api;

  function asyncStep() {
    // we cannot do anything until we receive 'initDone' message from worker
    // to confirm that it's ready to process layout requests.
    if (pendingInitialization) return;

    layoutWorker.postMessage(stepMessage);

    // TODO: I need to rewrite ngraph.forcelayout to be even-driven,
    // so that it can notify caller about stable/unstable change asynchronously
    return systemStable;
  }

  function asyncNodePosition(nodeId, x, y, z) {
    // let layout know that we changed the position
    layoutWorker.postMessage({
      kind: messageKind.setNodePosition,
      payload: {
        nodeId: nodeId,
        x: x,
        y: y,
        z: z
      }
    });
    // also update synchronously our last remember position:
    assignPosition(positions[nodeId], { x: x, y: y, z: z });
  }

  function getGraphRect() {
    return graphRect;
  }

  function asyncPinNode(node, isPinned) {
    layoutWorker.postMessage({
      kind: messageKind.pinNode,
      payload: {
        nodeId: node.id,
        isPinned: isPinned
      }
    });

    // we need to have sync way of answering to isNodePinned request.
    // This is not perfect, since original graph configuration may
    // include pinned nodes. We currently do not take that into account.
    pinStatus[node.id] = isPinned;
  }

  function isNodePinned(node) {
    return pinStatus[node.id];
  }

  function initWorker() {
    if (initRequestSent) {
      throw new Error('Init request is already sent to the worker');
    }

    layoutWorker.postMessage({
      kind: messageKind.init,
      payload: {
        graph: tojson(graph),
        options: JSON.stringify(options)
      }
    });

    initRequestSent = true;
  }

  function initPositions() {
    // we need to initialize positions just once
    var layout = createLayout(graph, options);
    graph.forEachNode(initPosition);
    graphRect = layout.getGraphRect();

    function initPosition(node) {
      positions[node.id] = layout.getNodePosition(node.id);
    }
  }

  function getNodePosition(nodeId) {
    return positions[nodeId];
  }

  function getLinkPosition(linkId) {
    if (!linkPositions) {
      initializeLinkPositions();
    }
    return linkPositions[linkId];
  }

  function initializeLinkPositions() {
    linkPositions = Object.create(null);
    graph.forEachLink(function(link) {
      linkPositions[link.id] = {
        from: getNodePosition(link.fromId),
        to: getNodePosition(link.toId)
      };
    });
  }

  function handleMessageFromWorker(message) {
    var kind = message.data.kind;
    var payload = message.data.payload

    if (kind === messageKind.cycleComplete) {
      setPositions(payload.positions, payload.systemStable);
      graphRect = payload.bbox;
      api.fire('cycle', payload.iterations, payload.systemStable);
    } if (kind === messageKind.initDone) {
      pendingInitialization = false;
      asyncStep();
    }
  }

  function setPositions(newPositions, newSystemStable) {
    systemStable = newSystemStable;
    Object.keys(newPositions).forEach(updatePosition);
    return;

    function updatePosition(nodeId) {
      var newPosition = newPositions[nodeId];
      var oldPosition = positions[nodeId];
      if (!oldPosition) {
        positions[nodeId] = newPosition;
      } else {
        assignPosition(oldPosition, newPosition);
      }
    }
  }
}

function assignPosition3d(oldPos, newPos) {
  oldPos.x = newPos.x;
  oldPos.y = newPos.y;
  oldPos.z = newPos.z;
}

function assignPosition2d(oldPos, newPos) {
  oldPos.x = newPos.x;
  oldPos.y = newPos.y;
}

},{"./lib/createLayout.js":3,"./lib/layoutWorker.js":4,"./lib/messages.js":5,"./options.js":6,"ngraph.events":7,"ngraph.tojson":37,"webworkify":40}],3:[function(_dereq_,module,exports){
var layout3d = _dereq_('ngraph.forcelayout3d');
var layout2d = layout3d.get2dLayout;

module.exports = createLayout;

function createLayout(graph, options) {
  options = options || {};

  return options.is3d ?
    layout3d(graph, options.physics) :
    layout2d(graph, options.physics);
}

},{"ngraph.forcelayout3d":9}],4:[function(_dereq_,module,exports){
var createLayout = _dereq_('./createLayout.js');
var fromjson = _dereq_('ngraph.fromjson');
var validateOptions = _dereq_('../options.js');
var messageKind = _dereq_('./messages.js');

module.exports = layoutWorker;

/**
 * This method is executed as a webworker thread. It expects 'init' signal
 * from the main thread to start layout.
 */
function layoutWorker(self) {
  var layout; // main thread will send a message to initialize this
  var asyncOptions;
  var completedIterations = 0;
  var stepCalled = false;
  var timeoutId = 0;
  var systemStable = false;
  var graph;

  var positions = Object.create(null);
  self.addEventListener('message', handleMessageFromMainThread);

  return; // public API is over. Below are private methods only.

  function handleMessageFromMainThread(message) {
    var kind = message.data.kind;
    var payload = message.data.payload;

    if (kind === messageKind.init) {
      graph = fromjson(payload.graph);
      var options = JSON.parse(payload.options);

      init(graph, options);
    } else if (kind === messageKind.step) {
      step();
    } else if (kind === messageKind.pinNode) {
      pinNode(payload.nodeId, payload.isPinned);
    } else if (kind === messageKind.setNodePosition) {
      setNodePosition(payload.nodeId, payload.x, payload.y, payload.z);
    }
    // TODO: listen for graph changes from main thread and update layout here.
  }

  function setNodePosition(nodeId, x, y, z) {
    assertInitialized();

    layout.setNodePosition.apply(layout, arguments);
    systemStable = false;
    step();
  }

  function pinNode(nodeId, isPinned) {
    assertInitialized();

    var node = graph.getNode(nodeId);
    if (!node) return; // ignoring right now. should it throw?

    layout.pinNode(node, isPinned);
  }

  function assertInitialized() {
    if (!graph) throw new Error('Pin node requested without initialied graph');
    if (!layout) throw new Error('Layout was not created. Something is really wrong here');
  }

  function init(graph, options) {
    // unfortunately we need to revalidate here, since POSITIVE_INFINITY could
    // be lost during threads transition
    options = validateOptions(options);
    asyncOptions = options.async;

    layout = createLayout(graph, options);
    graph.forEachNode(initPosition);

    // let main thread know that we can process layout
    self.postMessage({ kind: messageKind.initDone });
  }

  function initPosition(node) {
    positions[node.id] = layout.getNodePosition(node.id);
  }

  function step() {
    assertInitialized();

    stepCalled = true;

    if (!timeoutId) {
      runLayoutCycleAsync();
    }
  }

  function runLayoutCycleAsync() {
    if (systemStable) {
      timeoutId = 0;
      return;
    }

    // we have to unblock this thread to receive messages from the main thread.
    timeoutId = setTimeout(function() {
      runLayoutCycle();

      // We either wait until next `step` event from RAF, or run now if asked to
      // not wait for `step`.
      if (stepCalled || !asyncOptions.waitForStep) {
        stepCalled = false;
        runLayoutCycleAsync();
      } else {
        // wait for the next event from the main thread to continue;
        timeoutId = 0;
      }
    }, 0);
  }

  function runLayoutCycle() {
    var wasStable = systemStable;
    for (var i = 0; i < asyncOptions.stepsPerCycle; ++i) {
      systemStable = layout.step();
      completedIterations += 1;
    }

    if (completedIterations >= asyncOptions.maxIterations) {
      systemStable = true;
    }

    self.postMessage({
      kind: messageKind.cycleComplete,
      payload: {
        positions: positions,
        systemStable: systemStable,
        bbox: layout.getGraphRect(),
        iterations: completedIterations
      }
    });
  }
};

},{"../options.js":6,"./createLayout.js":3,"./messages.js":5,"ngraph.fromjson":23}],5:[function(_dereq_,module,exports){
/**
 * This file defines all possible messages between main thread and
 * web worker. The key is human readable message type, and the value is a
 * numeric attribute for quick matching
 */
module.exports = {
  /**
   * Sent from main thread to web worker to initialize force layout
   *
   * payload:
   *  {string} graph - result of ngraph.tojson(graph) operation.
   *  {string} options - stringified optinons received by ngraph.asyncforce().
   */
  init: 10,

  /**
   * Sent from web worker to main thread to confirm that worker has done
   * initializatino and can process incoming layout requests
   *
   * payload: undefined.
   */
  initDone: 11,

  /**
   * Sent from main thread to web worker to notify that rendering loop is currently
   * active and worker should perform layout (if required). Worker can decide
   * to ignore this request if, for example, layout is already computed, or
   * worker has performed more than options.async.maxIterations iterations.
   *
   * payload: undefined.
   */
  step: 12,

  /**
   * Sent from webworker to main thread to indicate that worker has finished
   * one cycle of layout iterations. Each cycle can perform up to
   * options.asnc.stepsPerCycle iterations of layout.
   *
   * payload:
   *  {object} positions - keys are node ids, values are {x, y, z} coordinates
   *  {boolean} systemStable - indicates that system is stable. NOTE: this will
   *  be removed from future version.
   */
  cycleComplete: 13,

  /**
   * Sent from main thread to web worker to pin node
   *
   * payload:
   *   {string} nodeId - identifier of the node that needs to be pinned
   *   {boolean} isPinned status of the node
   */
  pinNode: 41,

  /**
   * Sent from main thread to web worker to set position of the node
   *
   * payload:
   *  {string} nodeId - identifier of the node that needs position update.
   *  {number} x - x coordinate
   *  {number} y - y coordinate
   *  {number+} z - z coordinate - only applicable for 3d layout
   */
  setNodePosition: 43
};

},{}],6:[function(_dereq_,module,exports){
/**
 * This file defines configuration options for the asyncforce module. Every
 * configuration is optional. You can find its description and default value below.
 */
module.exports = validateOptions;

function validateOptions(options) {
  options = options || {};

  /**
   * Do we need to run 3D layout or 2D?
   */
  options.is3d = typeof options.is3d === 'boolean' ? options.is3d : false;

  // These options are in separate object since they configure web worker behavior
  // not layout.
  var async = (options.async = options.async || {});

  /**
   * Web worker computes layout in cycles. After each cycle is done web worker
   * notifies the main thread with updated positions. This options defines
   * how many layout steps should web worker complete within one cycle.
   */
  async.stepsPerCycle = typeof async.stepsPerCycle === 'number' ? async.stepsPerCycle : 5;

  /**
   * By default layout will be computed as long as each iteration brings too
   * much movement to the system. However if you'd like to compute only N iterations
   * of layout, you can set this option to N. Once layout reaches N it will consider
   * system stable and will not compute more iterations.
   */
  async.maxIterations = typeof async.maxIterations === 'number' ? async.maxIterations : Number.POSITIVE_INFINITY;

  /**
   * Unlike requestAnimationFrame() web workers are executed even when page is
   * not active (e.g. user switched to a different browser tab). This can result
   * in unnecessary CPU consumption and battery drain.
   *
   * By default asyncforce will calculate layout as long as you call
   * `asncforce.step()`. Normally you will call this method from
   * requestAnimationFrame() handler to manage CPU resources.
   *
   * However, if you prefer to keep computing layout in background set this
   * options to true. Layout will be computed until system is considered stable
   * (see `maxIterations` above).
   */
  async.waitForStep = typeof async.waitForStep === 'boolean' ? async.waitForStep : true;
  return options;
}

},{}],7:[function(_dereq_,module,exports){
module.exports = function(subject) {
  validateSubject(subject);

  var eventsStorage = createEventsStorage(subject);
  subject.on = eventsStorage.on;
  subject.off = eventsStorage.off;
  subject.fire = eventsStorage.fire;
  return subject;
};

function createEventsStorage(subject) {
  // Store all event listeners to this hash. Key is event name, value is array
  // of callback records.
  //
  // A callback record consists of callback function and its optional context:
  // { 'eventName' => [{callback: function, ctx: object}] }
  var registeredEvents = Object.create(null);

  return {
    on: function (eventName, callback, ctx) {
      if (typeof callback !== 'function') {
        throw new Error('callback is expected to be a function');
      }
      var handlers = registeredEvents[eventName];
      if (!handlers) {
        handlers = registeredEvents[eventName] = [];
      }
      handlers.push({callback: callback, ctx: ctx});

      return subject;
    },

    off: function (eventName, callback) {
      var wantToRemoveAll = (typeof eventName === 'undefined');
      if (wantToRemoveAll) {
        // Killing old events storage should be enough in this case:
        registeredEvents = Object.create(null);
        return subject;
      }

      if (registeredEvents[eventName]) {
        var deleteAllCallbacksForEvent = (typeof callback !== 'function');
        if (deleteAllCallbacksForEvent) {
          delete registeredEvents[eventName];
        } else {
          var callbacks = registeredEvents[eventName];
          for (var i = 0; i < callbacks.length; ++i) {
            if (callbacks[i].callback === callback) {
              callbacks.splice(i, 1);
            }
          }
        }
      }

      return subject;
    },

    fire: function (eventName) {
      var callbacks = registeredEvents[eventName];
      if (!callbacks) {
        return subject;
      }

      var fireArguments;
      if (arguments.length > 1) {
        fireArguments = Array.prototype.splice.call(arguments, 1);
      }
      for(var i = 0; i < callbacks.length; ++i) {
        var callbackInfo = callbacks[i];
        callbackInfo.callback.apply(callbackInfo.ctx, fireArguments);
      }

      return subject;
    }
  };
}

function validateSubject(subject) {
  if (!subject) {
    throw new Error('Eventify cannot use falsy object as events subject');
  }
  var reservedWords = ['on', 'fire', 'off'];
  for (var i = 0; i < reservedWords.length; ++i) {
    if (subject.hasOwnProperty(reservedWords[i])) {
      throw new Error("Subject cannot be eventified, since it already has property '" + reservedWords[i] + "'");
    }
  }
}

},{}],8:[function(_dereq_,module,exports){
module.exports = exposeProperties;

/**
 * Augments `target` object with getter/setter functions, which modify settings
 *
 * @example
 *  var target = {};
 *  exposeProperties({ age: 42}, target);
 *  target.age(); // returns 42
 *  target.age(24); // make age 24;
 *
 *  var filteredTarget = {};
 *  exposeProperties({ age: 42, name: 'John'}, filteredTarget, ['name']);
 *  filteredTarget.name(); // returns 'John'
 *  filteredTarget.age === undefined; // true
 */
function exposeProperties(settings, target, filter) {
  var needsFilter = Object.prototype.toString.call(filter) === '[object Array]';
  if (needsFilter) {
    for (var i = 0; i < filter.length; ++i) {
      augment(settings, target, filter[i]);
    }
  } else {
    for (var key in settings) {
      augment(settings, target, key);
    }
  }
}

function augment(source, target, key) {
  if (source.hasOwnProperty(key)) {
    if (typeof target[key] === 'function') {
      // this accessor is already defined. Ignore it
      return;
    }
    target[key] = function (value) {
      if (value !== undefined) {
        source[key] = value;
        return target;
      }
      return source[key];
    }
  }
}

},{}],9:[function(_dereq_,module,exports){
/**
 * This module provides all required forces to regular ngraph.physics.simulator
 * to make it 3D simulator. Ideally ngraph.physics.simulator should operate
 * with vectors, but on practices that showed performance decrease... Maybe
 * I was doing it wrong, will see if I can refactor/throw away this module.
 */
module.exports = createLayout;
createLayout.get2dLayout = _dereq_('ngraph.forcelayout');

function createLayout(graph, physicsSettings) {
  var merge = _dereq_('ngraph.merge');
  physicsSettings = merge(physicsSettings, {
        createQuadTree: _dereq_('ngraph.quadtreebh3d'),
        createBounds: _dereq_('./lib/bounds'),
        createDragForce: _dereq_('./lib/dragForce'),
        createSpringForce: _dereq_('./lib/springForce'),
        integrator: _dereq_('./lib/eulerIntegrator'),
        createBody: _dereq_('./lib/createBody')
      });

  return createLayout.get2dLayout(graph, physicsSettings);
}

},{"./lib/bounds":10,"./lib/createBody":11,"./lib/dragForce":12,"./lib/eulerIntegrator":13,"./lib/springForce":14,"ngraph.forcelayout":15,"ngraph.merge":26,"ngraph.quadtreebh3d":28}],10:[function(_dereq_,module,exports){
module.exports = function (bodies, settings) {
  var random = _dereq_('ngraph.random').random(42);
  var boundingBox =  { x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0 };

  return {
    box: boundingBox,

    update: updateBoundingBox,

    reset : function () {
      boundingBox.x1 = boundingBox.y1 = 0;
      boundingBox.x2 = boundingBox.y2 = 0;
      boundingBox.z1 = boundingBox.z2 = 0;
    },

    getBestNewPosition: function (neighbors) {
      var graphRect = boundingBox;

      var baseX = 0, baseY = 0, baseZ = 0;

      if (neighbors.length) {
        for (var i = 0; i < neighbors.length; ++i) {
          baseX += neighbors[i].pos.x;
          baseY += neighbors[i].pos.y;
          baseZ += neighbors[i].pos.z;
        }

        baseX /= neighbors.length;
        baseY /= neighbors.length;
        baseZ /= neighbors.length;
      } else {
        baseX = (graphRect.x1 + graphRect.x2) / 2;
        baseY = (graphRect.y1 + graphRect.y2) / 2;
        baseZ = (graphRect.z1 + graphRect.z2) / 2;
      }

      var springLength = settings.springLength;
      return {
        x: baseX + random.next(springLength) - springLength / 2,
        y: baseY + random.next(springLength) - springLength / 2,
        z: baseZ + random.next(springLength) - springLength / 2
      };
    }
  };

  function updateBoundingBox() {
    var i = bodies.length;
    if (i === 0) { return; } // don't have to wory here.

    var x1 = Number.MAX_VALUE,
        y1 = Number.MAX_VALUE,
        z1 = Number.MAX_VALUE,
        x2 = Number.MIN_VALUE,
        y2 = Number.MIN_VALUE,
        z2 = Number.MIN_VALUE;

    while(i--) {
      // this is O(n), could it be done faster with quadtree?
      // how about pinned nodes?
      var body = bodies[i];
      if (body.isPinned) {
        body.pos.x = body.prevPos.x;
        body.pos.y = body.prevPos.y;
        body.pos.z = body.prevPos.z;
      } else {
        body.prevPos.x = body.pos.x;
        body.prevPos.y = body.pos.y;
        body.prevPos.z = body.pos.z;
      }
      if (body.pos.x < x1) {
        x1 = body.pos.x;
      }
      if (body.pos.x > x2) {
        x2 = body.pos.x;
      }
      if (body.pos.y < y1) {
        y1 = body.pos.y;
      }
      if (body.pos.y > y2) {
        y2 = body.pos.y;
      }
      if (body.pos.z < z1) {
        z1 = body.pos.z;
      }
      if (body.pos.z > z2) {
        z2 = body.pos.z;
      }
    }

    boundingBox.x1 = x1;
    boundingBox.x2 = x2;
    boundingBox.y1 = y1;
    boundingBox.y2 = y2;
    boundingBox.z1 = z1;
    boundingBox.z2 = z2;
  }
};

},{"ngraph.random":36}],11:[function(_dereq_,module,exports){
var physics = _dereq_('ngraph.physics.primitives');

module.exports = function(pos) {
  return new physics.Body3d(pos);
}

},{"ngraph.physics.primitives":27}],12:[function(_dereq_,module,exports){
/**
 * Represents 3d drag force, which reduces force value on each step by given
 * coefficient.
 *
 * @param {Object} options for the drag force
 * @param {Number=} options.dragCoeff drag force coefficient. 0.1 by default
 */
module.exports = function (options) {
  var merge = _dereq_('ngraph.merge'),
      expose = _dereq_('ngraph.expose');

  options = merge(options, {
    dragCoeff: 0.02
  });

  var api = {
    update : function (body) {
      body.force.x -= options.dragCoeff * body.velocity.x;
      body.force.y -= options.dragCoeff * body.velocity.y;
      body.force.z -= options.dragCoeff * body.velocity.z;
    }
  };

  // let easy access to dragCoeff:
  expose(options, api, ['dragCoeff']);

  return api;
};

},{"ngraph.expose":8,"ngraph.merge":26}],13:[function(_dereq_,module,exports){
/**
 * Performs 3d forces integration, using given timestep. Uses Euler method to solve
 * differential equation (http://en.wikipedia.org/wiki/Euler_method ).
 *
 * @returns {Number} squared distance of total position updates.
 */

module.exports = integrate;

function integrate(bodies, timeStep) {
  var dx = 0, tx = 0,
      dy = 0, ty = 0,
      dz = 0, tz = 0,
      i,
      max = bodies.length;

  for (i = 0; i < max; ++i) {
    var body = bodies[i],
        coeff = timeStep / body.mass;

    body.velocity.x += coeff * body.force.x;
    body.velocity.y += coeff * body.force.y;
    body.velocity.z += coeff * body.force.z;

    var vx = body.velocity.x,
        vy = body.velocity.y,
        vz = body.velocity.z,
        v = Math.sqrt(vx * vx + vy * vy + vz * vz);

    if (v > 1) {
      body.velocity.x = vx / v;
      body.velocity.y = vy / v;
      body.velocity.z = vz / v;
    }

    dx = timeStep * body.velocity.x;
    dy = timeStep * body.velocity.y;
    dz = timeStep * body.velocity.z;

    body.pos.x += dx;
    body.pos.y += dy;
    body.pos.z += dz;

    tx += Math.abs(dx); ty += Math.abs(dy); tz += Math.abs(dz);
  }

  return (tx * tx + ty * ty + tz * tz)/bodies.length;
}

},{}],14:[function(_dereq_,module,exports){
/**
 * Represents 3d spring force, which updates forces acting on two bodies, conntected
 * by a spring.
 *
 * @param {Object} options for the spring force
 * @param {Number=} options.springCoeff spring force coefficient.
 * @param {Number=} options.springLength desired length of a spring at rest.
 */
module.exports = function (options) {
  var merge = _dereq_('ngraph.merge');
  var random = _dereq_('ngraph.random').random(42);
  var expose = _dereq_('ngraph.expose');

  options = merge(options, {
    springCoeff: 0.0002,
    springLength: 80
  });

  var api = {
    /**
     * Upsates forces acting on a spring
     */
    update : function (spring) {
      var body1 = spring.from,
          body2 = spring.to,
          length = spring.length < 0 ? options.springLength : spring.length,
          dx = body2.pos.x - body1.pos.x,
          dy = body2.pos.y - body1.pos.y,
          dz = body2.pos.z - body1.pos.z,
          r = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (r === 0) {
          dx = (random.nextDouble() - 0.5) / 50;
          dy = (random.nextDouble() - 0.5) / 50;
          dz = (random.nextDouble() - 0.5) / 50;
          r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }

      var d = r - length;
      var coeff = ((!spring.coeff || spring.coeff < 0) ? options.springCoeff : spring.coeff) * d / r * spring.weight;

      body1.force.x += coeff * dx;
      body1.force.y += coeff * dy;
      body1.force.z += coeff * dz;

      body2.force.x -= coeff * dx;
      body2.force.y -= coeff * dy;
      body2.force.z -= coeff * dz;
    }
  };

  expose(options, api, ['springCoeff', 'springLength']);
  return api;
}

},{"ngraph.expose":8,"ngraph.merge":26,"ngraph.random":36}],15:[function(_dereq_,module,exports){
module.exports = createLayout;
module.exports.simulator = _dereq_('ngraph.physics.simulator');

/**
 * Creates force based layout for a given graph.
 * @param {ngraph.graph} graph which needs to be laid out
 * @param {object} physicsSettings if you need custom settings
 * for physics simulator you can pass your own settings here. If it's not passed
 * a default one will be created.
 */
function createLayout(graph, physicsSettings) {
  if (!graph) {
    throw new Error('Graph structure cannot be undefined');
  }

  var createSimulator = _dereq_('ngraph.physics.simulator');
  var physicsSimulator = createSimulator(physicsSettings);

  var nodeBodies = typeof Object.create === 'function' ? Object.create(null) : {};
  var springs = {};

  var springTransform = physicsSimulator.settings.springTransform || noop;

  // Initialize physical objects according to what we have in the graph:
  initPhysics();
  listenToGraphEvents();

  var api = {
    /**
     * Performs one step of iterative layout algorithm
     */
    step: function() {
      return physicsSimulator.step();
    },

    /**
     * For a given `nodeId` returns position
     */
    getNodePosition: function (nodeId) {
      return getInitializedBody(nodeId).pos;
    },

    /**
     * Sets position of a node to a given coordinates
     * @param {string} nodeId node identifier
     * @param {number} x position of a node
     * @param {number} y position of a node
     * @param {number=} z position of node (only if applicable to body)
     */
    setNodePosition: function (nodeId) {
      var body = getInitializedBody(nodeId);
      body.setPosition.apply(body, Array.prototype.slice.call(arguments, 1));
    },

    /**
     * @returns {Object} Link position by link id
     * @returns {Object.from} {x, y} coordinates of link start
     * @returns {Object.to} {x, y} coordinates of link end
     */
    getLinkPosition: function (linkId) {
      var spring = springs[linkId];
      if (spring) {
        return {
          from: spring.from.pos,
          to: spring.to.pos
        };
      }
    },

    /**
     * @returns {Object} area required to fit in the graph. Object contains
     * `x1`, `y1` - top left coordinates
     * `x2`, `y2` - bottom right coordinates
     */
    getGraphRect: function () {
      return physicsSimulator.getBBox();
    },

    /*
     * Requests layout algorithm to pin/unpin node to its current position
     * Pinned nodes should not be affected by layout algorithm and always
     * remain at their position
     */
    pinNode: function (node, isPinned) {
      var body = getInitializedBody(node.id);
       body.isPinned = !!isPinned;
    },

    /**
     * Checks whether given graph's node is currently pinned
     */
    isNodePinned: function (node) {
      return getInitializedBody(node.id).isPinned;
    },

    /**
     * Request to release all resources
     */
    dispose: function() {
      graph.off('changed', onGraphChanged);
    },

    /**
     * Gets physical body for a given node id. If node is not found undefined
     * value is returned.
     */
    getBody: getBody,

    /**
     * Gets spring for a given edge.
     *
     * @param {string} linkId link identifer. If two arguments are passed then
     * this argument is treated as formNodeId
     * @param {string=} toId when defined this parameter denotes head of the link
     * and first argument is trated as tail of the link (fromId)
     */
    getSpring: getSpring,

    /**
     * [Read only] Gets current physics simulator
     */
    simulator: physicsSimulator
  };

  return api;

  function getSpring(fromId, toId) {
    var linkId;
    if (toId === undefined) {
      if (typeof fromId === 'string') {
        // assume fromId as a linkId:
        linkId = fromId;
      } else {
        // assume fromId to be a link object:
        linkId = fromId.id;
      }
    } else {
      // toId is defined, should grab link:
      var link = graph.hasLink(fromId, toId);
      if (!link) return;
      linkId = link.id;
    }

    return springs[linkId];
  }

  function getBody(nodeId) {
    return nodeBodies[nodeId];
  }

  function listenToGraphEvents() {
    graph.on('changed', onGraphChanged);
  }

  function onGraphChanged(changes) {
    for (var i = 0; i < changes.length; ++i) {
      var change = changes[i];
      if (change.changeType === 'add') {
        if (change.node) {
          initBody(change.node.id);
        }
        if (change.link) {
          initLink(change.link);
        }
      } else if (change.changeType === 'remove') {
        if (change.node) {
          releaseNode(change.node);
        }
        if (change.link) {
          releaseLink(change.link);
        }
      }
    }
  }

  function initPhysics() {
    graph.forEachNode(function (node) {
      initBody(node.id);
    });
    graph.forEachLink(initLink);
  }

  function initBody(nodeId) {
    var body = nodeBodies[nodeId];
    if (!body) {
      var node = graph.getNode(nodeId);
      if (!node) {
        throw new Error('initBody() was called with unknown node id');
      }

      var pos = node.position;
      if (!pos) {
        var neighbors = getNeighborBodies(node);
        pos = physicsSimulator.getBestNewBodyPosition(neighbors);
      }

      body = physicsSimulator.addBodyAt(pos);

      nodeBodies[nodeId] = body;
      updateBodyMass(nodeId);

      if (isNodeOriginallyPinned(node)) {
        body.isPinned = true;
      }
    }
  }

  function releaseNode(node) {
    var nodeId = node.id;
    var body = nodeBodies[nodeId];
    if (body) {
      nodeBodies[nodeId] = null;
      delete nodeBodies[nodeId];

      physicsSimulator.removeBody(body);
    }
  }

  function initLink(link) {
    updateBodyMass(link.fromId);
    updateBodyMass(link.toId);

    var fromBody = nodeBodies[link.fromId],
        toBody  = nodeBodies[link.toId],
        spring = physicsSimulator.addSpring(fromBody, toBody, link.length);

    springTransform(link, spring);

    springs[link.id] = spring;
  }

  function releaseLink(link) {
    var spring = springs[link.id];
    if (spring) {
      var from = graph.getNode(link.fromId),
          to = graph.getNode(link.toId);

      if (from) updateBodyMass(from.id);
      if (to) updateBodyMass(to.id);

      delete springs[link.id];

      physicsSimulator.removeSpring(spring);
    }
  }

  function getNeighborBodies(node) {
    // TODO: Could probably be done better on memory
    var neighbors = [];
    if (!node.links) {
      return neighbors;
    }
    var maxNeighbors = Math.min(node.links.length, 2);
    for (var i = 0; i < maxNeighbors; ++i) {
      var link = node.links[i];
      var otherBody = link.fromId !== node.id ? nodeBodies[link.fromId] : nodeBodies[link.toId];
      if (otherBody && otherBody.pos) {
        neighbors.push(otherBody);
      }
    }

    return neighbors;
  }

  function updateBodyMass(nodeId) {
    var body = nodeBodies[nodeId];
    body.mass = nodeMass(nodeId);
  }

  /**
   * Checks whether graph node has in its settings pinned attribute,
   * which means layout algorithm cannot move it. Node can be preconfigured
   * as pinned, if it has "isPinned" attribute, or when node.data has it.
   *
   * @param {Object} node a graph node to check
   * @return {Boolean} true if node should be treated as pinned; false otherwise.
   */
  function isNodeOriginallyPinned(node) {
    return (node && (node.isPinned || (node.data && node.data.isPinned)));
  }

  function getInitializedBody(nodeId) {
    var body = nodeBodies[nodeId];
    if (!body) {
      initBody(nodeId);
      body = nodeBodies[nodeId];
    }
    return body;
  }

  /**
   * Calculates mass of a body, which corresponds to node with given id.
   *
   * @param {String|Number} nodeId identifier of a node, for which body mass needs to be calculated
   * @returns {Number} recommended mass of the body;
   */
  function nodeMass(nodeId) {
    return 1 + graph.getLinks(nodeId).length / 3.0;
  }
}

function noop() { }

},{"ngraph.physics.simulator":16}],16:[function(_dereq_,module,exports){
/**
 * Manages a simulation of physical forces acting on bodies and springs.
 */
module.exports = physicsSimulator;

function physicsSimulator(settings) {
  var Spring = _dereq_('./lib/spring');
  var expose = _dereq_('ngraph.expose');
  var merge = _dereq_('ngraph.merge');

  settings = merge(settings, {
      /**
       * Ideal length for links (springs in physical model).
       */
      springLength: 30,

      /**
       * Hook's law coefficient. 1 - solid spring.
       */
      springCoeff: 0.0008,

      /**
       * Coulomb's law coefficient. It's used to repel nodes thus should be negative
       * if you make it positive nodes start attract each other :).
       */
      gravity: -1.2,

      /**
       * Theta coefficient from Barnes Hut simulation. Ranged between (0, 1).
       * The closer it's to 1 the more nodes algorithm will have to go through.
       * Setting it to one makes Barnes Hut simulation no different from
       * brute-force forces calculation (each node is considered).
       */
      theta: 0.8,

      /**
       * Drag force coefficient. Used to slow down system, thus should be less than 1.
       * The closer it is to 0 the less tight system will be.
       */
      dragCoeff: 0.02,

      /**
       * Default time step (dt) for forces integration
       */
      timeStep : 20,

      /**
        * Maximum movement of the system which can be considered as stabilized
        */
      stableThreshold: 0.009
  });

  // We allow clients to override basic factory methods:
  var createQuadTree = settings.createQuadTree || _dereq_('ngraph.quadtreebh');
  var createBounds = settings.createBounds || _dereq_('./lib/bounds');
  var createDragForce = settings.createDragForce || _dereq_('./lib/dragForce');
  var createSpringForce = settings.createSpringForce || _dereq_('./lib/springForce');
  var integrate = settings.integrator || _dereq_('./lib/eulerIntegrator');
  var createBody = settings.createBody || _dereq_('./lib/createBody');

  var bodies = [], // Bodies in this simulation.
      springs = [], // Springs in this simulation.
      quadTree =  createQuadTree(settings),
      bounds = createBounds(bodies, settings),
      springForce = createSpringForce(settings),
      dragForce = createDragForce(settings);

  var publicApi = {
    /**
     * Array of bodies, registered with current simulator
     *
     * Note: To add new body, use addBody() method. This property is only
     * exposed for testing/performance purposes.
     */
    bodies: bodies,

    /**
     * Array of springs, registered with current simulator
     *
     * Note: To add new spring, use addSpring() method. This property is only
     * exposed for testing/performance purposes.
     */
    springs: springs,

    /**
     * Returns settings with which current simulator was initialized
     */
    settings: settings,

    /**
     * Performs one step of force simulation.
     *
     * @returns {boolean} true if system is considered stable; False otherwise.
     */
    step: function () {
      accumulateForces();
      var totalMovement = integrate(bodies, settings.timeStep);

      bounds.update();

      return totalMovement < settings.stableThreshold;
    },

    /**
     * Adds body to the system
     *
     * @param {ngraph.physics.primitives.Body} body physical body
     *
     * @returns {ngraph.physics.primitives.Body} added body
     */
    addBody: function (body) {
      if (!body) {
        throw new Error('Body is required');
      }
      bodies.push(body);

      return body;
    },

    /**
     * Adds body to the system at given position
     *
     * @param {Object} pos position of a body
     *
     * @returns {ngraph.physics.primitives.Body} added body
     */
    addBodyAt: function (pos) {
      if (!pos) {
        throw new Error('Body position is required');
      }
      var body = createBody(pos);
      bodies.push(body);

      return body;
    },

    /**
     * Removes body from the system
     *
     * @param {ngraph.physics.primitives.Body} body to remove
     *
     * @returns {Boolean} true if body found and removed. falsy otherwise;
     */
    removeBody: function (body) {
      if (!body) { return; }

      var idx = bodies.indexOf(body);
      if (idx < 0) { return; }

      bodies.splice(idx, 1);
      if (bodies.length === 0) {
        bounds.reset();
      }
      return true;
    },

    /**
     * Adds a spring to this simulation.
     *
     * @returns {Object} - a handle for a spring. If you want to later remove
     * spring pass it to removeSpring() method.
     */
    addSpring: function (body1, body2, springLength, springWeight, springCoefficient) {
      if (!body1 || !body2) {
        throw new Error('Cannot add null spring to force simulator');
      }

      if (typeof springLength !== 'number') {
        springLength = -1; // assume global configuration
      }

      var spring = new Spring(body1, body2, springLength, springCoefficient >= 0 ? springCoefficient : -1, springWeight);
      springs.push(spring);

      // TODO: could mark simulator as dirty.
      return spring;
    },

    /**
     * Removes spring from the system
     *
     * @param {Object} spring to remove. Spring is an object returned by addSpring
     *
     * @returns {Boolean} true if spring found and removed. falsy otherwise;
     */
    removeSpring: function (spring) {
      if (!spring) { return; }
      var idx = springs.indexOf(spring);
      if (idx > -1) {
        springs.splice(idx, 1);
        return true;
      }
    },

    getBestNewBodyPosition: function (neighbors) {
      return bounds.getBestNewPosition(neighbors);
    },

    /**
     * Returns bounding box which covers all bodies
     */
    getBBox: function () {
      return bounds.box;
    },

    gravity: function (value) {
      if (value !== undefined) {
        settings.gravity = value;
        quadTree.options({gravity: value});
        return this;
      } else {
        return settings.gravity;
      }
    },

    theta: function (value) {
      if (value !== undefined) {
        settings.theta = value;
        quadTree.options({theta: value});
        return this;
      } else {
        return settings.theta;
      }
    }
  };

  // allow settings modification via public API:
  expose(settings, publicApi);

  return publicApi;

  function accumulateForces() {
    // Accumulate forces acting on bodies.
    var body,
        i = bodies.length;

    if (i) {
      // only add bodies if there the array is not empty:
      quadTree.insertBodies(bodies); // performance: O(n * log n)
      while (i--) {
        body = bodies[i];
        // If body is pinned there is no point updating its forces - it should
        // never move:
        if (!body.isPinned) {
          body.force.reset();

          quadTree.updateBodyForce(body);
          dragForce.update(body);
        }
      }
    }

    i = springs.length;
    while(i--) {
      springForce.update(springs[i]);
    }
  }
};

},{"./lib/bounds":17,"./lib/createBody":18,"./lib/dragForce":19,"./lib/eulerIntegrator":20,"./lib/spring":21,"./lib/springForce":22,"ngraph.expose":8,"ngraph.merge":26,"ngraph.quadtreebh":32}],17:[function(_dereq_,module,exports){
module.exports = function (bodies, settings) {
  var random = _dereq_('ngraph.random').random(42);
  var boundingBox =  { x1: 0, y1: 0, x2: 0, y2: 0 };

  return {
    box: boundingBox,

    update: updateBoundingBox,

    reset : function () {
      boundingBox.x1 = boundingBox.y1 = 0;
      boundingBox.x2 = boundingBox.y2 = 0;
    },

    getBestNewPosition: function (neighbors) {
      var graphRect = boundingBox;

      var baseX = 0, baseY = 0;

      if (neighbors.length) {
        for (var i = 0; i < neighbors.length; ++i) {
          baseX += neighbors[i].pos.x;
          baseY += neighbors[i].pos.y;
        }

        baseX /= neighbors.length;
        baseY /= neighbors.length;
      } else {
        baseX = (graphRect.x1 + graphRect.x2) / 2;
        baseY = (graphRect.y1 + graphRect.y2) / 2;
      }

      var springLength = settings.springLength;
      return {
        x: baseX + random.next(springLength) - springLength / 2,
        y: baseY + random.next(springLength) - springLength / 2
      };
    }
  };

  function updateBoundingBox() {
    var i = bodies.length;
    if (i === 0) { return; } // don't have to wory here.

    var x1 = Number.MAX_VALUE,
        y1 = Number.MAX_VALUE,
        x2 = Number.MIN_VALUE,
        y2 = Number.MIN_VALUE;

    while(i--) {
      // this is O(n), could it be done faster with quadtree?
      // how about pinned nodes?
      var body = bodies[i];
      if (body.isPinned) {
        body.pos.x = body.prevPos.x;
        body.pos.y = body.prevPos.y;
      } else {
        body.prevPos.x = body.pos.x;
        body.prevPos.y = body.pos.y;
      }
      if (body.pos.x < x1) {
        x1 = body.pos.x;
      }
      if (body.pos.x > x2) {
        x2 = body.pos.x;
      }
      if (body.pos.y < y1) {
        y1 = body.pos.y;
      }
      if (body.pos.y > y2) {
        y2 = body.pos.y;
      }
    }

    boundingBox.x1 = x1;
    boundingBox.x2 = x2;
    boundingBox.y1 = y1;
    boundingBox.y2 = y2;
  }
}

},{"ngraph.random":36}],18:[function(_dereq_,module,exports){
var physics = _dereq_('ngraph.physics.primitives');

module.exports = function(pos) {
  return new physics.Body(pos);
}

},{"ngraph.physics.primitives":27}],19:[function(_dereq_,module,exports){
/**
 * Represents drag force, which reduces force value on each step by given
 * coefficient.
 *
 * @param {Object} options for the drag force
 * @param {Number=} options.dragCoeff drag force coefficient. 0.1 by default
 */
module.exports = function (options) {
  var merge = _dereq_('ngraph.merge'),
      expose = _dereq_('ngraph.expose');

  options = merge(options, {
    dragCoeff: 0.02
  });

  var api = {
    update : function (body) {
      body.force.x -= options.dragCoeff * body.velocity.x;
      body.force.y -= options.dragCoeff * body.velocity.y;
    }
  };

  // let easy access to dragCoeff:
  expose(options, api, ['dragCoeff']);

  return api;
};

},{"ngraph.expose":8,"ngraph.merge":26}],20:[function(_dereq_,module,exports){
/**
 * Performs forces integration, using given timestep. Uses Euler method to solve
 * differential equation (http://en.wikipedia.org/wiki/Euler_method ).
 *
 * @returns {Number} squared distance of total position updates.
 */

module.exports = integrate;

function integrate(bodies, timeStep) {
  var dx = 0, tx = 0,
      dy = 0, ty = 0,
      i,
      max = bodies.length;

  for (i = 0; i < max; ++i) {
    var body = bodies[i],
        coeff = timeStep / body.mass;

    body.velocity.x += coeff * body.force.x;
    body.velocity.y += coeff * body.force.y;
    var vx = body.velocity.x,
        vy = body.velocity.y,
        v = Math.sqrt(vx * vx + vy * vy);

    if (v > 1) {
      body.velocity.x = vx / v;
      body.velocity.y = vy / v;
    }

    dx = timeStep * body.velocity.x;
    dy = timeStep * body.velocity.y;

    body.pos.x += dx;
    body.pos.y += dy;

    tx += Math.abs(dx); ty += Math.abs(dy);
  }

  return (tx * tx + ty * ty)/bodies.length;
}

},{}],21:[function(_dereq_,module,exports){
module.exports = Spring;

/**
 * Represents a physical spring. Spring connects two bodies, has rest length
 * stiffness coefficient and optional weight
 */
function Spring(fromBody, toBody, length, coeff, weight) {
    this.from = fromBody;
    this.to = toBody;
    this.length = length;
    this.coeff = coeff;

    this.weight = typeof weight === 'number' ? weight : 1;
};

},{}],22:[function(_dereq_,module,exports){
/**
 * Represents spring force, which updates forces acting on two bodies, conntected
 * by a spring.
 *
 * @param {Object} options for the spring force
 * @param {Number=} options.springCoeff spring force coefficient.
 * @param {Number=} options.springLength desired length of a spring at rest.
 */
module.exports = function (options) {
  var merge = _dereq_('ngraph.merge');
  var random = _dereq_('ngraph.random').random(42);
  var expose = _dereq_('ngraph.expose');

  options = merge(options, {
    springCoeff: 0.0002,
    springLength: 80
  });

  var api = {
    /**
     * Upsates forces acting on a spring
     */
    update : function (spring) {
      var body1 = spring.from,
          body2 = spring.to,
          length = spring.length < 0 ? options.springLength : spring.length,
          dx = body2.pos.x - body1.pos.x,
          dy = body2.pos.y - body1.pos.y,
          r = Math.sqrt(dx * dx + dy * dy);

      if (r === 0) {
          dx = (random.nextDouble() - 0.5) / 50;
          dy = (random.nextDouble() - 0.5) / 50;
          r = Math.sqrt(dx * dx + dy * dy);
      }

      var d = r - length;
      var coeff = ((!spring.coeff || spring.coeff < 0) ? options.springCoeff : spring.coeff) * d / r * spring.weight;

      body1.force.x += coeff * dx;
      body1.force.y += coeff * dy;

      body2.force.x -= coeff * dx;
      body2.force.y -= coeff * dy;
    }
  };

  expose(options, api, ['springCoeff', 'springLength']);
  return api;
}

},{"ngraph.expose":8,"ngraph.merge":26,"ngraph.random":36}],23:[function(_dereq_,module,exports){
module.exports = load;

var createGraph = _dereq_('ngraph.graph');

function load(jsonGraph, nodeTransform, linkTransform) {
  var stored;
  nodeTransform = nodeTransform || id;
  linkTransform = linkTransform || id;
  if (typeof jsonGraph === 'string') {
    stored = JSON.parse(jsonGraph);
  } else {
    stored = jsonGraph;
  }

  var graph = createGraph(),
      i;

  if (stored.links === undefined || stored.nodes === undefined) {
    throw new Error('Cannot load graph without links and nodes');
  }

  for (i = 0; i < stored.nodes.length; ++i) {
    var parsedNode = nodeTransform(stored.nodes[i]);
    if (!parsedNode.hasOwnProperty('id')) {
      throw new Error('Graph node format is invalid: Node id is missing');
    }

    graph.addNode(parsedNode.id, parsedNode.data);
  }

  for (i = 0; i < stored.links.length; ++i) {
    var link = linkTransform(stored.links[i]);
    if (!link.hasOwnProperty('fromId') || !link.hasOwnProperty('toId')) {
      throw new Error('Graph link format is invalid. Both fromId and toId are required');
    }

    graph.addLink(link.fromId, link.toId, link.data);
  }

  return graph;
}

function id(x) { return x; }

},{"ngraph.graph":24}],24:[function(_dereq_,module,exports){
/**
 * @fileOverview Contains definition of the core graph object.
 */

/**
 * @example
 *  var graph = require('ngraph.graph')();
 *  graph.addNode(1);     // graph has one node.
 *  graph.addLink(2, 3);  // now graph contains three nodes and one link.
 *
 */
module.exports = createGraph;

var eventify = _dereq_('ngraph.events');

/**
 * Creates a new graph
 */
function createGraph(options) {
  // Graph structure is maintained as dictionary of nodes
  // and array of links. Each node has 'links' property which
  // hold all links related to that node. And general links
  // array is used to speed up all links enumeration. This is inefficient
  // in terms of memory, but simplifies coding.
  options = options || {};
  if (options.uniqueLinkId === undefined) {
    // Request each link id to be unique between same nodes. This negatively
    // impacts `addLink()` performance (O(n), where n - number of edges of each
    // vertex), but makes operations with multigraphs more accessible.
    options.uniqueLinkId = true;
  }

  var nodes = typeof Object.create === 'function' ? Object.create(null) : {},
    links = [],
    // Hash of multi-edges. Used to track ids of edges between same nodes
    multiEdges = {},
    nodesCount = 0,
    suspendEvents = 0,

    forEachNode = createNodeIterator(),
    createLink = options.uniqueLinkId ? createUniqueLink : createSingleLink,

    // Our graph API provides means to listen to graph changes. Users can subscribe
    // to be notified about changes in the graph by using `on` method. However
    // in some cases they don't use it. To avoid unnecessary memory consumption
    // we will not record graph changes until we have at least one subscriber.
    // Code below supports this optimization.
    //
    // Accumulates all changes made during graph updates.
    // Each change element contains:
    //  changeType - one of the strings: 'add', 'remove' or 'update';
    //  node - if change is related to node this property is set to changed graph's node;
    //  link - if change is related to link this property is set to changed graph's link;
    changes = [],
    recordLinkChange = noop,
    recordNodeChange = noop,
    enterModification = noop,
    exitModification = noop;

  // this is our public API:
  var graphPart = {
    /**
     * Adds node to the graph. If node with given id already exists in the graph
     * its data is extended with whatever comes in 'data' argument.
     *
     * @param nodeId the node's identifier. A string or number is preferred.
     * @param [data] additional data for the node being added. If node already
     *   exists its data object is augmented with the new one.
     *
     * @return {node} The newly added node or node with given id if it already exists.
     */
    addNode: addNode,

    /**
     * Adds a link to the graph. The function always create a new
     * link between two nodes. If one of the nodes does not exists
     * a new node is created.
     *
     * @param fromId link start node id;
     * @param toId link end node id;
     * @param [data] additional data to be set on the new link;
     *
     * @return {link} The newly created link
     */
    addLink: addLink,

    /**
     * Removes link from the graph. If link does not exist does nothing.
     *
     * @param link - object returned by addLink() or getLinks() methods.
     *
     * @returns true if link was removed; false otherwise.
     */
    removeLink: removeLink,

    /**
     * Removes node with given id from the graph. If node does not exist in the graph
     * does nothing.
     *
     * @param nodeId node's identifier passed to addNode() function.
     *
     * @returns true if node was removed; false otherwise.
     */
    removeNode: removeNode,

    /**
     * Gets node with given identifier. If node does not exist undefined value is returned.
     *
     * @param nodeId requested node identifier;
     *
     * @return {node} in with requested identifier or undefined if no such node exists.
     */
    getNode: getNode,

    /**
     * Gets number of nodes in this graph.
     *
     * @return number of nodes in the graph.
     */
    getNodesCount: function() {
      return nodesCount;
    },

    /**
     * Gets total number of links in the graph.
     */
    getLinksCount: function() {
      return links.length;
    },

    /**
     * Gets all links (inbound and outbound) from the node with given id.
     * If node with given id is not found null is returned.
     *
     * @param nodeId requested node identifier.
     *
     * @return Array of links from and to requested node if such node exists;
     *   otherwise null is returned.
     */
    getLinks: getLinks,

    /**
     * Invokes callback on each node of the graph.
     *
     * @param {Function(node)} callback Function to be invoked. The function
     *   is passed one argument: visited node.
     */
    forEachNode: forEachNode,

    /**
     * Invokes callback on every linked (adjacent) node to the given one.
     *
     * @param nodeId Identifier of the requested node.
     * @param {Function(node, link)} callback Function to be called on all linked nodes.
     *   The function is passed two parameters: adjacent node and link object itself.
     * @param oriented if true graph treated as oriented.
     */
    forEachLinkedNode: forEachLinkedNode,

    /**
     * Enumerates all links in the graph
     *
     * @param {Function(link)} callback Function to be called on all links in the graph.
     *   The function is passed one parameter: graph's link object.
     *
     * Link object contains at least the following fields:
     *  fromId - node id where link starts;
     *  toId - node id where link ends,
     *  data - additional data passed to graph.addLink() method.
     */
    forEachLink: forEachLink,

    /**
     * Suspend all notifications about graph changes until
     * endUpdate is called.
     */
    beginUpdate: enterModification,

    /**
     * Resumes all notifications about graph changes and fires
     * graph 'changed' event in case there are any pending changes.
     */
    endUpdate: exitModification,

    /**
     * Removes all nodes and links from the graph.
     */
    clear: clear,

    /**
     * Detects whether there is a link between two nodes.
     * Operation complexity is O(n) where n - number of links of a node.
     * NOTE: this function is synonim for getLink()
     *
     * @returns link if there is one. null otherwise.
     */
    hasLink: getLink,

    /**
     * Gets an edge between two nodes.
     * Operation complexity is O(n) where n - number of links of a node.
     *
     * @param {string} fromId link start identifier
     * @param {string} toId link end identifier
     *
     * @returns link if there is one. null otherwise.
     */
    getLink: getLink
  };

  // this will add `on()` and `fire()` methods.
  eventify(graphPart);

  monitorSubscribers();

  return graphPart;

  function monitorSubscribers() {
    var realOn = graphPart.on;

    // replace real `on` with our temporary on, which will trigger change
    // modification monitoring:
    graphPart.on = on;

    function on() {
      // now it's time to start tracking stuff:
      graphPart.beginUpdate = enterModification = enterModificationReal;
      graphPart.endUpdate = exitModification = exitModificationReal;
      recordLinkChange = recordLinkChangeReal;
      recordNodeChange = recordNodeChangeReal;

      // this will replace current `on` method with real pub/sub from `eventify`.
      graphPart.on = realOn;
      // delegate to real `on` handler:
      return realOn.apply(graphPart, arguments);
    }
  }

  function recordLinkChangeReal(link, changeType) {
    changes.push({
      link: link,
      changeType: changeType
    });
  }

  function recordNodeChangeReal(node, changeType) {
    changes.push({
      node: node,
      changeType: changeType
    });
  }

  function addNode(nodeId, data) {
    if (nodeId === undefined) {
      throw new Error('Invalid node identifier');
    }

    enterModification();

    var node = getNode(nodeId);
    if (!node) {
      node = new Node(nodeId);
      nodesCount++;
      recordNodeChange(node, 'add');
    } else {
      recordNodeChange(node, 'update');
    }

    node.data = data;

    nodes[nodeId] = node;

    exitModification();
    return node;
  }

  function getNode(nodeId) {
    return nodes[nodeId];
  }

  function removeNode(nodeId) {
    var node = getNode(nodeId);
    if (!node) {
      return false;
    }

    enterModification();

    if (node.links) {
      while (node.links.length) {
        var link = node.links[0];
        removeLink(link);
      }
    }

    delete nodes[nodeId];
    nodesCount--;

    recordNodeChange(node, 'remove');

    exitModification();

    return true;
  }


  function addLink(fromId, toId, data) {
    enterModification();

    var fromNode = getNode(fromId) || addNode(fromId);
    var toNode = getNode(toId) || addNode(toId);

    var link = createLink(fromId, toId, data);

    links.push(link);

    // TODO: this is not cool. On large graphs potentially would consume more memory.
    addLinkToNode(fromNode, link);
    if (fromId !== toId) {
      // make sure we are not duplicating links for self-loops
      addLinkToNode(toNode, link);
    }

    recordLinkChange(link, 'add');

    exitModification();

    return link;
  }

  function createSingleLink(fromId, toId, data) {
    var linkId = makeLinkId(fromId, toId);
    return new Link(fromId, toId, data, linkId);
  }

  function createUniqueLink(fromId, toId, data) {
    // TODO: Get rid of this method.
    var linkId = makeLinkId(fromId, toId);
    var isMultiEdge = multiEdges.hasOwnProperty(linkId);
    if (isMultiEdge || getLink(fromId, toId)) {
      if (!isMultiEdge) {
        multiEdges[linkId] = 0;
      }
      var suffix = '@' + (++multiEdges[linkId]);
      linkId = makeLinkId(fromId + suffix, toId + suffix);
    }

    return new Link(fromId, toId, data, linkId);
  }

  function getLinks(nodeId) {
    var node = getNode(nodeId);
    return node ? node.links : null;
  }

  function removeLink(link) {
    if (!link) {
      return false;
    }
    var idx = indexOfElementInArray(link, links);
    if (idx < 0) {
      return false;
    }

    enterModification();

    links.splice(idx, 1);

    var fromNode = getNode(link.fromId);
    var toNode = getNode(link.toId);

    if (fromNode) {
      idx = indexOfElementInArray(link, fromNode.links);
      if (idx >= 0) {
        fromNode.links.splice(idx, 1);
      }
    }

    if (toNode) {
      idx = indexOfElementInArray(link, toNode.links);
      if (idx >= 0) {
        toNode.links.splice(idx, 1);
      }
    }

    recordLinkChange(link, 'remove');

    exitModification();

    return true;
  }

  function getLink(fromNodeId, toNodeId) {
    // TODO: Use sorted links to speed this up
    var node = getNode(fromNodeId),
      i;
    if (!node || !node.links) {
      return null;
    }

    for (i = 0; i < node.links.length; ++i) {
      var link = node.links[i];
      if (link.fromId === fromNodeId && link.toId === toNodeId) {
        return link;
      }
    }

    return null; // no link.
  }

  function clear() {
    enterModification();
    forEachNode(function(node) {
      removeNode(node.id);
    });
    exitModification();
  }

  function forEachLink(callback) {
    var i, length;
    if (typeof callback === 'function') {
      for (i = 0, length = links.length; i < length; ++i) {
        callback(links[i]);
      }
    }
  }

  function forEachLinkedNode(nodeId, callback, oriented) {
    var node = getNode(nodeId);

    if (node && node.links && typeof callback === 'function') {
      if (oriented) {
        return forEachOrientedLink(node.links, nodeId, callback);
      } else {
        return forEachNonOrientedLink(node.links, nodeId, callback);
      }
    }
  }

  function forEachNonOrientedLink(links, nodeId, callback) {
    var quitFast;
    for (var i = 0; i < links.length; ++i) {
      var link = links[i];
      var linkedNodeId = link.fromId === nodeId ? link.toId : link.fromId;

      quitFast = callback(nodes[linkedNodeId], link);
      if (quitFast) {
        return true; // Client does not need more iterations. Break now.
      }
    }
  }

  function forEachOrientedLink(links, nodeId, callback) {
    var quitFast;
    for (var i = 0; i < links.length; ++i) {
      var link = links[i];
      if (link.fromId === nodeId) {
        quitFast = callback(nodes[link.toId], link);
        if (quitFast) {
          return true; // Client does not need more iterations. Break now.
        }
      }
    }
  }

  // we will not fire anything until users of this library explicitly call `on()`
  // method.
  function noop() {}

  // Enter, Exit modification allows bulk graph updates without firing events.
  function enterModificationReal() {
    suspendEvents += 1;
  }

  function exitModificationReal() {
    suspendEvents -= 1;
    if (suspendEvents === 0 && changes.length > 0) {
      graphPart.fire('changed', changes);
      changes.length = 0;
    }
  }

  function createNodeIterator() {
    // Object.keys iterator is 1.3x faster than `for in` loop.
    // See `https://github.com/anvaka/ngraph.graph/tree/bench-for-in-vs-obj-keys`
    // branch for perf test
    return Object.keys ? objectKeysIterator : forInIterator;
  }

  function objectKeysIterator(callback) {
    if (typeof callback !== 'function') {
      return;
    }

    var keys = Object.keys(nodes);
    for (var i = 0; i < keys.length; ++i) {
      if (callback(nodes[keys[i]])) {
        return true; // client doesn't want to proceed. Return.
      }
    }
  }

  function forInIterator(callback) {
    if (typeof callback !== 'function') {
      return;
    }
    var node;

    for (node in nodes) {
      if (callback(nodes[node])) {
        return true; // client doesn't want to proceed. Return.
      }
    }
  }
}

// need this for old browsers. Should this be a separate module?
function indexOfElementInArray(element, array) {
  if (!array) return -1;

  if (array.indexOf) {
    return array.indexOf(element);
  }

  var len = array.length,
    i;

  for (i = 0; i < len; i += 1) {
    if (array[i] === element) {
      return i;
    }
  }

  return -1;
}

/**
 * Internal structure to represent node;
 */
function Node(id) {
  this.id = id;
  this.links = null;
  this.data = null;
}

function addLinkToNode(node, link) {
  if (node.links) {
    node.links.push(link);
  } else {
    node.links = [link];
  }
}

/**
 * Internal structure to represent links;
 */
function Link(fromId, toId, data, id) {
  this.fromId = fromId;
  this.toId = toId;
  this.data = data;
  this.id = id;
}

function hashCode(str) {
  var hash = 0, i, chr, len;
  if (str.length == 0) return hash;
  for (i = 0, len = str.length; i < len; i++) {
    chr   = str.charCodeAt(i);
    hash  = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

function makeLinkId(fromId, toId) {
  return hashCode(fromId.toString() + '👉 ' + toId.toString());
}

},{"ngraph.events":25}],25:[function(_dereq_,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],26:[function(_dereq_,module,exports){
module.exports = merge;

/**
 * Augments `target` with properties in `options`. Does not override
 * target's properties if they are defined and matches expected type in 
 * options
 *
 * @returns {Object} merged object
 */
function merge(target, options) {
  var key;
  if (!target) { target = {}; }
  if (options) {
    for (key in options) {
      if (options.hasOwnProperty(key)) {
        var targetHasIt = target.hasOwnProperty(key),
            optionsValueType = typeof options[key],
            shouldReplace = !targetHasIt || (typeof target[key] !== optionsValueType);

        if (shouldReplace) {
          target[key] = options[key];
        } else if (optionsValueType === 'object') {
          // go deep, don't care about loops here, we are simple API!:
          target[key] = merge(target[key], options[key]);
        }
      }
    }
  }

  return target;
}

},{}],27:[function(_dereq_,module,exports){
module.exports = {
  Body: Body,
  Vector2d: Vector2d,
  Body3d: Body3d,
  Vector3d: Vector3d
};

function Body(x, y) {
  this.pos = new Vector2d(x, y);
  this.prevPos = new Vector2d(x, y);
  this.force = new Vector2d();
  this.velocity = new Vector2d();
  this.mass = 1;
}

Body.prototype.setPosition = function (x, y) {
  this.prevPos.x = this.pos.x = x;
  this.prevPos.y = this.pos.y = y;
};

function Vector2d(x, y) {
  if (x && typeof x !== 'number') {
    // could be another vector
    this.x = typeof x.x === 'number' ? x.x : 0;
    this.y = typeof x.y === 'number' ? x.y : 0;
  } else {
    this.x = typeof x === 'number' ? x : 0;
    this.y = typeof y === 'number' ? y : 0;
  }
}

Vector2d.prototype.reset = function () {
  this.x = this.y = 0;
};

function Body3d(x, y, z) {
  this.pos = new Vector3d(x, y, z);
  this.prevPos = new Vector3d(x, y, z);
  this.force = new Vector3d();
  this.velocity = new Vector3d();
  this.mass = 1;
}

Body3d.prototype.setPosition = function (x, y, z) {
  this.prevPos.x = this.pos.x = x;
  this.prevPos.y = this.pos.y = y;
  this.prevPos.z = this.pos.z = z;
};

function Vector3d(x, y, z) {
  if (x && typeof x !== 'number') {
    // could be another vector
    this.x = typeof x.x === 'number' ? x.x : 0;
    this.y = typeof x.y === 'number' ? x.y : 0;
    this.z = typeof x.z === 'number' ? x.z : 0;
  } else {
    this.x = typeof x === 'number' ? x : 0;
    this.y = typeof y === 'number' ? y : 0;
    this.z = typeof z === 'number' ? z : 0;
  }
};

Vector3d.prototype.reset = function () {
  this.x = this.y = this.z = 0;
};

},{}],28:[function(_dereq_,module,exports){
/**
 * This is Barnes Hut simulation algorithm for 3d case. Implementation
 * is highly optimized (avoids recusion and gc pressure)
 *
 * http://www.cs.princeton.edu/courses/archive/fall03/cs126/assignments/barnes-hut.html
 *
 * NOTE: This module duplicates a lot of code from 2d case. Primary reason for
 * this is performance. Every time I tried to abstract away vector operations
 * I had negative impact on performance. So in this case I'm scarifying code
 * reuse in favor of speed
 */

module.exports = function(options) {
  options = options || {};
  options.gravity = typeof options.gravity === 'number' ? options.gravity : -1;
  options.theta = typeof options.theta === 'number' ? options.theta : 0.8;

  // we require deterministic randomness here
  var random = _dereq_('ngraph.random').random(1984),
    Node = _dereq_('./node'),
    InsertStack = _dereq_('./insertStack'),
    isSamePosition = _dereq_('./isSamePosition');

  var gravity = options.gravity,
    updateQueue = [],
    insertStack = new InsertStack(),
    theta = options.theta,

    nodesCache = [],
    currentInCache = 0,
    newNode = function() {
      // To avoid pressure on GC we reuse nodes.
      var node = nodesCache[currentInCache];
      if (node) {
        node.quad0 = null;
        node.quad4 = null;
        node.quad1 = null;
        node.quad5 = null;
        node.quad2 = null;
        node.quad6 = null;
        node.quad3 = null;
        node.quad7 = null;
        node.body = null;
        node.mass = node.massX = node.massY = node.massZ = 0;
        node.left = node.right = node.top = node.bottom = node.front = node.back = 0;
      } else {
        node = new Node();
        nodesCache[currentInCache] = node;
      }

      ++currentInCache;
      return node;
    },

    root = newNode(),

    // Inserts body to the tree
    insert = function(newBody) {
      insertStack.reset();
      insertStack.push(root, newBody);

      while (!insertStack.isEmpty()) {
        var stackItem = insertStack.pop(),
          node = stackItem.node,
          body = stackItem.body;

        if (!node.body) {
          // This is internal node. Update the total mass of the node and center-of-mass.
          var x = body.pos.x;
          var y = body.pos.y;
          var z = body.pos.z;
          node.mass += body.mass;
          node.massX += body.mass * x;
          node.massY += body.mass * y;
          node.massZ += body.mass * z;

          // Recursively insert the body in the appropriate quadrant.
          // But first find the appropriate quadrant.
          var quadIdx = 0, // Assume we are in the 0's quad.
            left = node.left,
            right = (node.right + left) / 2,
            top = node.top,
            bottom = (node.bottom + top) / 2,
            back = node.back,
            front = (node.front + back) / 2;

          if (x > right) { // somewhere in the eastern part.
            quadIdx += 1;
            var oldLeft = left;
            left = right;
            right = right + (right - oldLeft);
          }
          if (y > bottom) { // and in south.
            quadIdx += 2;
            var oldTop = top;
            top = bottom;
            bottom = bottom + (bottom - oldTop);
          }
          if (z > front) { // and in frontal part
            quadIdx += 4;
            var oldBack = back;
            back = front;
            front = back + (back - oldBack);
          }

          var child = getChild(node, quadIdx);
          if (!child) {
            // The node is internal but this quadrant is not taken. Add subnode to it.
            child = newNode();
            child.left = left;
            child.top = top;
            child.right = right;
            child.bottom = bottom;
            child.back = back;
            child.front = front;
            child.body = body;

            setChild(node, quadIdx, child);
          } else {
            // continue searching in this quadrant.
            insertStack.push(child, body);
          }
        } else {
          // We are trying to add to the leaf node.
          // We have to convert current leaf into internal node
          // and continue adding two nodes.
          var oldBody = node.body;
          node.body = null; // internal nodes do not carry bodies

          if (isSamePosition(oldBody.pos, body.pos)) {
            // Prevent infinite subdivision by bumping one node
            // anywhere in this quadrant
            var retriesCount = 3;
            do {
              var offset = random.nextDouble();
              var dx = (node.right - node.left) * offset;
              var dy = (node.bottom - node.top) * offset;
              var dz = (node.front - node.back) * offset;

              oldBody.pos.x = node.left + dx;
              oldBody.pos.y = node.top + dy;
              oldBody.pos.z = node.back + dz;
              retriesCount -= 1;
              // Make sure we don't bump it out of the box. If we do, next iteration should fix it
            } while (retriesCount > 0 && isSamePosition(oldBody.pos, body.pos));

            if (retriesCount === 0 && isSamePosition(oldBody.pos, body.pos)) {
              // This is very bad, we ran out of precision.
              // if we do not return from the method we'll get into
              // infinite loop here. So we sacrifice correctness of layout, and keep the app running
              // Next layout iteration should get larger bounding box in the first step and fix this
              return;
            }
          }
          // Next iteration should subdivide node further.
          insertStack.push(node, oldBody);
          insertStack.push(node, body);
        }
      }
    },

    update = function(sourceBody) {
      var queue = updateQueue,
        v,
        dx, dy, dz,
        r, fx = 0,
        fy = 0,
        fz = 0,
        queueLength = 1,
        shiftIdx = 0,
        pushIdx = 1;

      queue[0] = root;

      while (queueLength) {
        var node = queue[shiftIdx],
          body = node.body;

        queueLength -= 1;
        shiftIdx += 1;
        var differentBody = (body !== sourceBody);
        if (body && differentBody) {
          // If the current node is a leaf node (and it is not source body),
          // calculate the force exerted by the current node on body, and add this
          // amount to body's net force.
          dx = body.pos.x - sourceBody.pos.x;
          dy = body.pos.y - sourceBody.pos.y;
          dz = body.pos.z - sourceBody.pos.z;
          r = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (r === 0) {
            // Poor man's protection against zero distance.
            dx = (random.nextDouble() - 0.5) / 50;
            dy = (random.nextDouble() - 0.5) / 50;
            dz = (random.nextDouble() - 0.5) / 50;
            r = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }

          // This is standard gravitation force calculation but we divide
          // by r^3 to save two operations when normalizing force vector.
          v = gravity * body.mass * sourceBody.mass / (r * r * r);
          fx += v * dx;
          fy += v * dy;
          fz += v * dz;
        } else if (differentBody) {
          // Otherwise, calculate the ratio s / r,  where s is the width of the region
          // represented by the internal node, and r is the distance between the body
          // and the node's center-of-mass
          dx = node.massX / node.mass - sourceBody.pos.x;
          dy = node.massY / node.mass - sourceBody.pos.y;
          dz = node.massZ / node.mass - sourceBody.pos.z;

          r = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (r === 0) {
            // Sorry about code duplication. I don't want to create many functions
            // right away. Just want to see performance first.
            dx = (random.nextDouble() - 0.5) / 50;
            dy = (random.nextDouble() - 0.5) / 50;
            dz = (random.nextDouble() - 0.5) / 50;
            r = Math.sqrt(dx * dx + dy * dy + dz * dz);
          }

          // If s / r < θ, treat this internal node as a single body, and calculate the
          // force it exerts on sourceBody, and add this amount to sourceBody's net force.
          if ((node.right - node.left) / r < theta) {
            // in the if statement above we consider node's width only
            // because the region was squarified during tree creation.
            // Thus there is no difference between using width or height.
            v = gravity * node.mass * sourceBody.mass / (r * r * r);
            fx += v * dx;
            fy += v * dy;
            fz += v * dz;
          } else {
            // Otherwise, run the procedure recursively on each of the current node's children.

            // I intentionally unfolded this loop, to save several CPU cycles.
            if (node.quad0) {
              queue[pushIdx] = node.quad0;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad1) {
              queue[pushIdx] = node.quad1;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad2) {
              queue[pushIdx] = node.quad2;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad3) {
              queue[pushIdx] = node.quad3;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad4) {
              queue[pushIdx] = node.quad4;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad5) {
              queue[pushIdx] = node.quad5;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad6) {
              queue[pushIdx] = node.quad6;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad7) {
              queue[pushIdx] = node.quad7;
              queueLength += 1;
              pushIdx += 1;
            }
          }
        }
      }

      sourceBody.force.x += fx;
      sourceBody.force.y += fy;
      sourceBody.force.z += fz;
    },

    insertBodies = function(bodies) {
      var x1 = Number.MAX_VALUE,
        y1 = Number.MAX_VALUE,
        z1 = Number.MAX_VALUE,
        x2 = Number.MIN_VALUE,
        y2 = Number.MIN_VALUE,
        z2 = Number.MIN_VALUE,
        i,
        max = bodies.length;

      // To reduce quad tree depth we are looking for exact bounding box of all particles.
      i = max;
      while (i--) {
        var pos = bodies[i].pos;
        var x = pos.x;
        var y = pos.y;
        var z = pos.z;
        if (x < x1) {
          x1 = x;
        }
        if (x > x2) {
          x2 = x;
        }
        if (y < y1) {
          y1 = y;
        }
        if (y > y2) {
          y2 = y;
        }
        if (z < z1) {
          z1 = z;
        }
        if (z > z2) {
          z2 = z;
        }
      }

      // Squarify the bounds.
      var maxSide = Math.max(x2 - x1, Math.max(y2 - y1, z2 - z1));

      x2 = x1 + maxSide;
      y2 = y1 + maxSide;
      z2 = z1 + maxSide;

      currentInCache = 0;
      root = newNode();
      root.left = x1;
      root.right = x2;
      root.top = y1;
      root.bottom = y2;
      root.back = z1;
      root.front = z2;

      i = max - 1;
      if (i > 0) {
        root.body = bodies[i];
      }
      while (i--) {
        insert(bodies[i], root);
      }
    };

  return {
    insertBodies: insertBodies,
    updateBodyForce: update,
    options: function(newOptions) {
      if (newOptions) {
        if (typeof newOptions.gravity === 'number') {
          gravity = newOptions.gravity;
        }
        if (typeof newOptions.theta === 'number') {
          theta = newOptions.theta;
        }

        return this;
      }

      return {
        gravity: gravity,
        theta: theta
      };
    }
  };
};

function getChild(node, idx) {
  if (idx === 0) return node.quad0;
  if (idx === 1) return node.quad1;
  if (idx === 2) return node.quad2;
  if (idx === 3) return node.quad3;
  if (idx === 4) return node.quad4;
  if (idx === 5) return node.quad5;
  if (idx === 6) return node.quad6;
  if (idx === 7) return node.quad7;
  return null;
}

function setChild(node, idx, child) {
  if (idx === 0) node.quad0 = child;
  else if (idx === 1) node.quad1 = child;
  else if (idx === 2) node.quad2 = child;
  else if (idx === 3) node.quad3 = child;
  else if (idx === 4) node.quad4 = child;
  else if (idx === 5) node.quad5 = child;
  else if (idx === 6) node.quad6 = child;
  else if (idx === 7) node.quad7 = child;
}

},{"./insertStack":29,"./isSamePosition":30,"./node":31,"ngraph.random":36}],29:[function(_dereq_,module,exports){
module.exports = InsertStack;

/**
 * Our implementation of QuadTree is non-recursive to avoid GC hit
 * This data structure represent stack of elements
 * which we are trying to insert into quad tree.
 */
function InsertStack () {
    this.stack = [];
    this.popIdx = 0;
}

InsertStack.prototype = {
    isEmpty: function() {
        return this.popIdx === 0;
    },
    push: function (node, body) {
        var item = this.stack[this.popIdx];
        if (!item) {
            // we are trying to avoid memory pressure: create new element
            // only when absolutely necessary
            this.stack[this.popIdx] = new InsertStackElement(node, body);
        } else {
            item.node = node;
            item.body = body;
        }
        ++this.popIdx;
    },
    pop: function () {
        if (this.popIdx > 0) {
            return this.stack[--this.popIdx];
        }
    },
    reset: function () {
        this.popIdx = 0;
    }
};

function InsertStackElement(node, body) {
    this.node = node; // QuadTree node
    this.body = body; // physical body which needs to be inserted to node
}

},{}],30:[function(_dereq_,module,exports){
module.exports = function isSamePosition(point1, point2) {
    var dx = Math.abs(point1.x - point2.x);
    var dy = Math.abs(point1.y - point2.y);
    var dz = Math.abs(point1.z - point2.z);

    return (dx < 1e-8 && dy < 1e-8 && dz < 1e-8);
};

},{}],31:[function(_dereq_,module,exports){
/**
 * Internal data structure to represent 3D QuadTree node
 */
module.exports = function Node() {
  // body stored inside this node. In quad tree only leaf nodes (by construction)
  // contain boides:
  this.body = null;

  // Child nodes are stored in quads. Each quad is presented by number:
  // Behind Z median:
  // 0 | 1
  // -----
  // 2 | 3
  // In front of Z median:
  // 4 | 5
  // -----
  // 6 | 7
  this.quad0 = null;
  this.quad1 = null;
  this.quad2 = null;
  this.quad3 = null;
  this.quad4 = null;
  this.quad5 = null;
  this.quad6 = null;
  this.quad7 = null;

  // Total mass of current node
  this.mass = 0;

  // Center of mass coordinates
  this.massX = 0;
  this.massY = 0;
  this.massZ = 0;

  // bounding box coordinates
  this.left = 0;
  this.top = 0;
  this.bottom = 0;
  this.right = 0;
  this.front = 0;
  this.back = 0;
};

},{}],32:[function(_dereq_,module,exports){
/**
 * This is Barnes Hut simulation algorithm for 2d case. Implementation
 * is highly optimized (avoids recusion and gc pressure)
 *
 * http://www.cs.princeton.edu/courses/archive/fall03/cs126/assignments/barnes-hut.html
 */

module.exports = function(options) {
  options = options || {};
  options.gravity = typeof options.gravity === 'number' ? options.gravity : -1;
  options.theta = typeof options.theta === 'number' ? options.theta : 0.8;

  // we require deterministic randomness here
  var random = _dereq_('ngraph.random').random(1984),
    Node = _dereq_('./node'),
    InsertStack = _dereq_('./insertStack'),
    isSamePosition = _dereq_('./isSamePosition');

  var gravity = options.gravity,
    updateQueue = [],
    insertStack = new InsertStack(),
    theta = options.theta,

    nodesCache = [],
    currentInCache = 0,
    newNode = function() {
      // To avoid pressure on GC we reuse nodes.
      var node = nodesCache[currentInCache];
      if (node) {
        node.quad0 = null;
        node.quad1 = null;
        node.quad2 = null;
        node.quad3 = null;
        node.body = null;
        node.mass = node.massX = node.massY = 0;
        node.left = node.right = node.top = node.bottom = 0;
      } else {
        node = new Node();
        nodesCache[currentInCache] = node;
      }

      ++currentInCache;
      return node;
    },

    root = newNode(),

    // Inserts body to the tree
    insert = function(newBody) {
      insertStack.reset();
      insertStack.push(root, newBody);

      while (!insertStack.isEmpty()) {
        var stackItem = insertStack.pop(),
          node = stackItem.node,
          body = stackItem.body;

        if (!node.body) {
          // This is internal node. Update the total mass of the node and center-of-mass.
          var x = body.pos.x;
          var y = body.pos.y;
          node.mass = node.mass + body.mass;
          node.massX = node.massX + body.mass * x;
          node.massY = node.massY + body.mass * y;

          // Recursively insert the body in the appropriate quadrant.
          // But first find the appropriate quadrant.
          var quadIdx = 0, // Assume we are in the 0's quad.
            left = node.left,
            right = (node.right + left) / 2,
            top = node.top,
            bottom = (node.bottom + top) / 2;

          if (x > right) { // somewhere in the eastern part.
            quadIdx = quadIdx + 1;
            var oldLeft = left;
            left = right;
            right = right + (right - oldLeft);
          }
          if (y > bottom) { // and in south.
            quadIdx = quadIdx + 2;
            var oldTop = top;
            top = bottom;
            bottom = bottom + (bottom - oldTop);
          }

          var child = getChild(node, quadIdx);
          if (!child) {
            // The node is internal but this quadrant is not taken. Add
            // subnode to it.
            child = newNode();
            child.left = left;
            child.top = top;
            child.right = right;
            child.bottom = bottom;
            child.body = body;

            setChild(node, quadIdx, child);
          } else {
            // continue searching in this quadrant.
            insertStack.push(child, body);
          }
        } else {
          // We are trying to add to the leaf node.
          // We have to convert current leaf into internal node
          // and continue adding two nodes.
          var oldBody = node.body;
          node.body = null; // internal nodes do not cary bodies

          if (isSamePosition(oldBody.pos, body.pos)) {
            // Prevent infinite subdivision by bumping one node
            // anywhere in this quadrant
            var retriesCount = 3;
            do {
              var offset = random.nextDouble();
              var dx = (node.right - node.left) * offset;
              var dy = (node.bottom - node.top) * offset;

              oldBody.pos.x = node.left + dx;
              oldBody.pos.y = node.top + dy;
              retriesCount -= 1;
              // Make sure we don't bump it out of the box. If we do, next iteration should fix it
            } while (retriesCount > 0 && isSamePosition(oldBody.pos, body.pos));

            if (retriesCount === 0 && isSamePosition(oldBody.pos, body.pos)) {
              // This is very bad, we ran out of precision.
              // if we do not return from the method we'll get into
              // infinite loop here. So we sacrifice correctness of layout, and keep the app running
              // Next layout iteration should get larger bounding box in the first step and fix this
              return;
            }
          }
          // Next iteration should subdivide node further.
          insertStack.push(node, oldBody);
          insertStack.push(node, body);
        }
      }
    },

    update = function(sourceBody) {
      var queue = updateQueue,
        v,
        dx,
        dy,
        r, fx = 0,
        fy = 0,
        queueLength = 1,
        shiftIdx = 0,
        pushIdx = 1;

      queue[0] = root;

      while (queueLength) {
        var node = queue[shiftIdx],
          body = node.body;

        queueLength -= 1;
        shiftIdx += 1;
        var differentBody = (body !== sourceBody);
        if (body && differentBody) {
          // If the current node is a leaf node (and it is not source body),
          // calculate the force exerted by the current node on body, and add this
          // amount to body's net force.
          dx = body.pos.x - sourceBody.pos.x;
          dy = body.pos.y - sourceBody.pos.y;
          r = Math.sqrt(dx * dx + dy * dy);

          if (r === 0) {
            // Poor man's protection against zero distance.
            dx = (random.nextDouble() - 0.5) / 50;
            dy = (random.nextDouble() - 0.5) / 50;
            r = Math.sqrt(dx * dx + dy * dy);
          }

          // This is standard gravition force calculation but we divide
          // by r^3 to save two operations when normalizing force vector.
          v = gravity * body.mass * sourceBody.mass / (r * r * r);
          fx += v * dx;
          fy += v * dy;
        } else if (differentBody) {
          // Otherwise, calculate the ratio s / r,  where s is the width of the region
          // represented by the internal node, and r is the distance between the body
          // and the node's center-of-mass
          dx = node.massX / node.mass - sourceBody.pos.x;
          dy = node.massY / node.mass - sourceBody.pos.y;
          r = Math.sqrt(dx * dx + dy * dy);

          if (r === 0) {
            // Sorry about code duplucation. I don't want to create many functions
            // right away. Just want to see performance first.
            dx = (random.nextDouble() - 0.5) / 50;
            dy = (random.nextDouble() - 0.5) / 50;
            r = Math.sqrt(dx * dx + dy * dy);
          }
          // If s / r < θ, treat this internal node as a single body, and calculate the
          // force it exerts on sourceBody, and add this amount to sourceBody's net force.
          if ((node.right - node.left) / r < theta) {
            // in the if statement above we consider node's width only
            // because the region was squarified during tree creation.
            // Thus there is no difference between using width or height.
            v = gravity * node.mass * sourceBody.mass / (r * r * r);
            fx += v * dx;
            fy += v * dy;
          } else {
            // Otherwise, run the procedure recursively on each of the current node's children.

            // I intentionally unfolded this loop, to save several CPU cycles.
            if (node.quad0) {
              queue[pushIdx] = node.quad0;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad1) {
              queue[pushIdx] = node.quad1;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad2) {
              queue[pushIdx] = node.quad2;
              queueLength += 1;
              pushIdx += 1;
            }
            if (node.quad3) {
              queue[pushIdx] = node.quad3;
              queueLength += 1;
              pushIdx += 1;
            }
          }
        }
      }

      sourceBody.force.x += fx;
      sourceBody.force.y += fy;
    },

    insertBodies = function(bodies) {
      var x1 = Number.MAX_VALUE,
        y1 = Number.MAX_VALUE,
        x2 = Number.MIN_VALUE,
        y2 = Number.MIN_VALUE,
        i,
        max = bodies.length;

      // To reduce quad tree depth we are looking for exact bounding box of all particles.
      i = max;
      while (i--) {
        var x = bodies[i].pos.x;
        var y = bodies[i].pos.y;
        if (x < x1) {
          x1 = x;
        }
        if (x > x2) {
          x2 = x;
        }
        if (y < y1) {
          y1 = y;
        }
        if (y > y2) {
          y2 = y;
        }
      }

      // Squarify the bounds.
      var dx = x2 - x1,
        dy = y2 - y1;
      if (dx > dy) {
        y2 = y1 + dx;
      } else {
        x2 = x1 + dy;
      }

      currentInCache = 0;
      root = newNode();
      root.left = x1;
      root.right = x2;
      root.top = y1;
      root.bottom = y2;

      i = max - 1;
      if (i > 0) {
        root.body = bodies[i];
      }
      while (i--) {
        insert(bodies[i], root);
      }
    };

  return {
    insertBodies: insertBodies,
    updateBodyForce: update,
    options: function(newOptions) {
      if (newOptions) {
        if (typeof newOptions.gravity === 'number') {
          gravity = newOptions.gravity;
        }
        if (typeof newOptions.theta === 'number') {
          theta = newOptions.theta;
        }

        return this;
      }

      return {
        gravity: gravity,
        theta: theta
      };
    }
  };
};

function getChild(node, idx) {
  if (idx === 0) return node.quad0;
  if (idx === 1) return node.quad1;
  if (idx === 2) return node.quad2;
  if (idx === 3) return node.quad3;
  return null;
}

function setChild(node, idx, child) {
  if (idx === 0) node.quad0 = child;
  else if (idx === 1) node.quad1 = child;
  else if (idx === 2) node.quad2 = child;
  else if (idx === 3) node.quad3 = child;
}

},{"./insertStack":33,"./isSamePosition":34,"./node":35,"ngraph.random":36}],33:[function(_dereq_,module,exports){
module.exports = InsertStack;

/**
 * Our implmentation of QuadTree is non-recursive to avoid GC hit
 * This data structure represent stack of elements
 * which we are trying to insert into quad tree.
 */
function InsertStack () {
    this.stack = [];
    this.popIdx = 0;
}

InsertStack.prototype = {
    isEmpty: function() {
        return this.popIdx === 0;
    },
    push: function (node, body) {
        var item = this.stack[this.popIdx];
        if (!item) {
            // we are trying to avoid memory pressue: create new element
            // only when absolutely necessary
            this.stack[this.popIdx] = new InsertStackElement(node, body);
        } else {
            item.node = node;
            item.body = body;
        }
        ++this.popIdx;
    },
    pop: function () {
        if (this.popIdx > 0) {
            return this.stack[--this.popIdx];
        }
    },
    reset: function () {
        this.popIdx = 0;
    }
};

function InsertStackElement(node, body) {
    this.node = node; // QuadTree node
    this.body = body; // physical body which needs to be inserted to node
}

},{}],34:[function(_dereq_,module,exports){
module.exports = function isSamePosition(point1, point2) {
    var dx = Math.abs(point1.x - point2.x);
    var dy = Math.abs(point1.y - point2.y);

    return (dx < 1e-8 && dy < 1e-8);
};

},{}],35:[function(_dereq_,module,exports){
/**
 * Internal data structure to represent 2D QuadTree node
 */
module.exports = function Node() {
  // body stored inside this node. In quad tree only leaf nodes (by construction)
  // contain boides:
  this.body = null;

  // Child nodes are stored in quads. Each quad is presented by number:
  // 0 | 1
  // -----
  // 2 | 3
  this.quad0 = null;
  this.quad1 = null;
  this.quad2 = null;
  this.quad3 = null;

  // Total mass of current node
  this.mass = 0;

  // Center of mass coordinates
  this.massX = 0;
  this.massY = 0;

  // bounding box coordinates
  this.left = 0;
  this.top = 0;
  this.bottom = 0;
  this.right = 0;
};

},{}],36:[function(_dereq_,module,exports){
module.exports = {
  random: random,
  randomIterator: randomIterator
};

/**
 * Creates seeded PRNG with two methods:
 *   next() and nextDouble()
 */
function random(inputSeed) {
  var seed = typeof inputSeed === 'number' ? inputSeed : (+ new Date());
  var randomFunc = function() {
      // Robert Jenkins' 32 bit integer hash function.
      seed = ((seed + 0x7ed55d16) + (seed << 12))  & 0xffffffff;
      seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
      seed = ((seed + 0x165667b1) + (seed << 5))   & 0xffffffff;
      seed = ((seed + 0xd3a2646c) ^ (seed << 9))   & 0xffffffff;
      seed = ((seed + 0xfd7046c5) + (seed << 3))   & 0xffffffff;
      seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
      return (seed & 0xfffffff) / 0x10000000;
  };

  return {
      /**
       * Generates random integer number in the range from 0 (inclusive) to maxValue (exclusive)
       *
       * @param maxValue Number REQUIRED. Ommitting this number will result in NaN values from PRNG.
       */
      next : function (maxValue) {
          return Math.floor(randomFunc() * maxValue);
      },

      /**
       * Generates random double number in the range from 0 (inclusive) to 1 (exclusive)
       * This function is the same as Math.random() (except that it could be seeded)
       */
      nextDouble : function () {
          return randomFunc();
      }
  };
}

/*
 * Creates iterator over array, which returns items of array in random order
 * Time complexity is guaranteed to be O(n);
 */
function randomIterator(array, customRandom) {
    var localRandom = customRandom || random();
    if (typeof localRandom.next !== 'function') {
      throw new Error('customRandom does not match expected API: next() function is missing');
    }

    return {
        forEach : function (callback) {
            var i, j, t;
            for (i = array.length - 1; i > 0; --i) {
                j = localRandom.next(i + 1); // i inclusive
                t = array[j];
                array[j] = array[i];
                array[i] = t;

                callback(t);
            }

            if (array.length) {
                callback(array[0]);
            }
        },

        /**
         * Shuffles array randomly, in place.
         */
        shuffle : function () {
            var i, j, t;
            for (i = array.length - 1; i > 0; --i) {
                j = localRandom.next(i + 1); // i inclusive
                t = array[j];
                array[j] = array[i];
                array[i] = t;
            }

            return array;
        }
    };
}

},{}],37:[function(_dereq_,module,exports){
module.exports = save;

function save(graph, customNodeTransform, customLinkTransform) {
  // Object contains `nodes` and `links` arrays.
  var result = {
    nodes: [],
    links: []
  };

  var nodeTransform = customNodeTransform || defaultTransformForNode;
  var linkTransform = customLinkTransform || defaultTransformForLink;

  graph.forEachNode(saveNode);
  graph.forEachLink(saveLink);

  return JSON.stringify(result);

  function saveNode(node) {
    // Each node of the graph is processed to take only required fields
    // `id` and `data`
    result.nodes.push(nodeTransform(node));
  }

  function saveLink(link) {
    // Each link of the graph is also processed to take `fromId`, `toId` and
    // `data`
    result.links.push(linkTransform(link));
  }

  function defaultTransformForNode(node) {
    var result = {
      id: node.id
    };
    // We don't want to store undefined fields when it's not necessary:
    if (node.data !== undefined) {
      result.data = node.data;
    }

    return result;
  }

  function defaultTransformForLink(link) {
    var result = {
      fromId: link.fromId,
      toId: link.toId,
    };

    if (link.data !== undefined) {
      result.data = link.data;
    }

    return result;
  }
}

},{}],38:[function(_dereq_,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],39:[function(_dereq_,module,exports){
//     Underscore.js 1.8.3
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind,
    nativeCreate       = Object.create;

  // Naked function reference for surrogate-prototype-swapping.
  var Ctor = function(){};

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root._ = _;
  }

  // Current version.
  _.VERSION = '1.8.3';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var optimizeCb = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  var cb = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return optimizeCb(value, context, argCount);
    if (_.isObject(value)) return _.matcher(value);
    return _.property(value);
  };
  _.iteratee = function(value, context) {
    return cb(value, context, Infinity);
  };

  // An internal function for creating assigner functions.
  var createAssigner = function(keysFunc, undefinedOnly) {
    return function(obj) {
      var length = arguments.length;
      if (length < 2 || obj == null) return obj;
      for (var index = 1; index < length; index++) {
        var source = arguments[index],
            keys = keysFunc(source),
            l = keys.length;
        for (var i = 0; i < l; i++) {
          var key = keys[i];
          if (!undefinedOnly || obj[key] === void 0) obj[key] = source[key];
        }
      }
      return obj;
    };
  };

  // An internal function for creating a new object that inherits from another.
  var baseCreate = function(prototype) {
    if (!_.isObject(prototype)) return {};
    if (nativeCreate) return nativeCreate(prototype);
    Ctor.prototype = prototype;
    var result = new Ctor;
    Ctor.prototype = null;
    return result;
  };

  var property = function(key) {
    return function(obj) {
      return obj == null ? void 0 : obj[key];
    };
  };

  // Helper for collection methods to determine whether a collection
  // should be iterated as an array or as an object
  // Related: http://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength
  // Avoids a very nasty iOS 8 JIT bug on ARM-64. #2094
  var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
  var getLength = property('length');
  var isArrayLike = function(collection) {
    var length = getLength(collection);
    return typeof length == 'number' && length >= 0 && length <= MAX_ARRAY_INDEX;
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    iteratee = optimizeCb(iteratee, context);
    var i, length;
    if (isArrayLike(obj)) {
      for (i = 0, length = obj.length; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length);
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  // Create a reducing function iterating left or right.
  function createReduce(dir) {
    // Optimized iterator function as using arguments.length
    // in the main function will deoptimize the, see #1991.
    function iterator(obj, iteratee, memo, keys, index, length) {
      for (; index >= 0 && index < length; index += dir) {
        var currentKey = keys ? keys[index] : index;
        memo = iteratee(memo, obj[currentKey], currentKey, obj);
      }
      return memo;
    }

    return function(obj, iteratee, memo, context) {
      iteratee = optimizeCb(iteratee, context, 4);
      var keys = !isArrayLike(obj) && _.keys(obj),
          length = (keys || obj).length,
          index = dir > 0 ? 0 : length - 1;
      // Determine the initial value if none is provided.
      if (arguments.length < 3) {
        memo = obj[keys ? keys[index] : index];
        index += dir;
      }
      return iterator(obj, iteratee, memo, keys, index, length);
    };
  }

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = createReduce(1);

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = createReduce(-1);

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var key;
    if (isArrayLike(obj)) {
      key = _.findIndex(obj, predicate, context);
    } else {
      key = _.findKey(obj, predicate, context);
    }
    if (key !== void 0 && key !== -1) return obj[key];
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    predicate = cb(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(cb(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given item (using `===`).
  // Aliased as `includes` and `include`.
  _.contains = _.includes = _.include = function(obj, item, fromIndex, guard) {
    if (!isArrayLike(obj)) obj = _.values(obj);
    if (typeof fromIndex != 'number' || guard) fromIndex = 0;
    return _.indexOf(obj, item, fromIndex) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      var func = isFunc ? method : value[method];
      return func == null ? func : func.apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matcher(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matcher(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = isArrayLike(obj) ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (!isArrayLike(obj)) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (isArrayLike(obj)) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return isArrayLike(obj) ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    return _.initial(array, array.length - n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return _.rest(array, Math.max(0, array.length - n));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, startIndex) {
    var output = [], idx = 0;
    for (var i = startIndex || 0, length = getLength(input); i < length; i++) {
      var value = input[i];
      if (isArrayLike(value) && (_.isArray(value) || _.isArguments(value))) {
        //flatten current level of array or arguments object
        if (!shallow) value = flatten(value, shallow, strict);
        var j = 0, len = value.length;
        output.length += len;
        while (j < len) {
          output[idx++] = value[j++];
        }
      } else if (!strict) {
        output[idx++] = value;
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = cb(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = getLength(array); i < length; i++) {
      var value = array[i],
          computed = iteratee ? iteratee(value, i, array) : value;
      if (isSorted) {
        if (!i || seen !== computed) result.push(value);
        seen = computed;
      } else if (iteratee) {
        if (!_.contains(seen, computed)) {
          seen.push(computed);
          result.push(value);
        }
      } else if (!_.contains(result, value)) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = getLength(array); i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(arguments, true, true, 1);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    return _.unzip(arguments);
  };

  // Complement of _.zip. Unzip accepts an array of arrays and groups
  // each array's elements on shared indices
  _.unzip = function(array) {
    var length = array && _.max(array, getLength).length || 0;
    var result = Array(length);

    for (var index = 0; index < length; index++) {
      result[index] = _.pluck(array, index);
    }
    return result;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    var result = {};
    for (var i = 0, length = getLength(list); i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Generator function to create the findIndex and findLastIndex functions
  function createPredicateIndexFinder(dir) {
    return function(array, predicate, context) {
      predicate = cb(predicate, context);
      var length = getLength(array);
      var index = dir > 0 ? 0 : length - 1;
      for (; index >= 0 && index < length; index += dir) {
        if (predicate(array[index], index, array)) return index;
      }
      return -1;
    };
  }

  // Returns the first index on an array-like that passes a predicate test
  _.findIndex = createPredicateIndexFinder(1);
  _.findLastIndex = createPredicateIndexFinder(-1);

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = cb(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = getLength(array);
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Generator function to create the indexOf and lastIndexOf functions
  function createIndexFinder(dir, predicateFind, sortedIndex) {
    return function(array, item, idx) {
      var i = 0, length = getLength(array);
      if (typeof idx == 'number') {
        if (dir > 0) {
            i = idx >= 0 ? idx : Math.max(idx + length, i);
        } else {
            length = idx >= 0 ? Math.min(idx + 1, length) : idx + length + 1;
        }
      } else if (sortedIndex && idx && length) {
        idx = sortedIndex(array, item);
        return array[idx] === item ? idx : -1;
      }
      if (item !== item) {
        idx = predicateFind(slice.call(array, i, length), _.isNaN);
        return idx >= 0 ? idx + i : -1;
      }
      for (idx = dir > 0 ? i : length - 1; idx >= 0 && idx < length; idx += dir) {
        if (array[idx] === item) return idx;
      }
      return -1;
    };
  }

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = createIndexFinder(1, _.findIndex, _.sortedIndex);
  _.lastIndexOf = createIndexFinder(-1, _.findLastIndex);

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (stop == null) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Determines whether to execute a function as a constructor
  // or a normal function with the provided arguments
  var executeBound = function(sourceFunc, boundFunc, context, callingContext, args) {
    if (!(callingContext instanceof boundFunc)) return sourceFunc.apply(context, args);
    var self = baseCreate(sourceFunc.prototype);
    var result = sourceFunc.apply(self, args);
    if (_.isObject(result)) return result;
    return self;
  };

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    var args = slice.call(arguments, 2);
    var bound = function() {
      return executeBound(func, bound, context, this, args.concat(slice.call(arguments)));
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    var bound = function() {
      var position = 0, length = boundArgs.length;
      var args = Array(length);
      for (var i = 0; i < length; i++) {
        args[i] = boundArgs[i] === _ ? arguments[position++] : boundArgs[i];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return executeBound(func, bound, this, this, args);
    };
    return bound;
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = '' + (hasher ? hasher.apply(this, arguments) : key);
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = _.partial(_.delay, _, 1);

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last >= 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed on and after the Nth call.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed up to (but not including) the Nth call.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      }
      if (times <= 1) func = null;
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Keys in IE < 9 that won't be iterated by `for key in ...` and thus missed.
  var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
  var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
                      'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];

  function collectNonEnumProps(obj, keys) {
    var nonEnumIdx = nonEnumerableProps.length;
    var constructor = obj.constructor;
    var proto = (_.isFunction(constructor) && constructor.prototype) || ObjProto;

    // Constructor is a special case.
    var prop = 'constructor';
    if (_.has(obj, prop) && !_.contains(keys, prop)) keys.push(prop);

    while (nonEnumIdx--) {
      prop = nonEnumerableProps[nonEnumIdx];
      if (prop in obj && obj[prop] !== proto[prop] && !_.contains(keys, prop)) {
        keys.push(prop);
      }
    }
  }

  // Retrieve the names of an object's own properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve all the property names of an object.
  _.allKeys = function(obj) {
    if (!_.isObject(obj)) return [];
    var keys = [];
    for (var key in obj) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Returns the results of applying the iteratee to each element of the object
  // In contrast to _.map it returns an object
  _.mapObject = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys =  _.keys(obj),
          length = keys.length,
          results = {},
          currentKey;
      for (var index = 0; index < length; index++) {
        currentKey = keys[index];
        results[currentKey] = iteratee(obj[currentKey], currentKey, obj);
      }
      return results;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = createAssigner(_.allKeys);

  // Assigns a given object with all the own properties in the passed-in object(s)
  // (https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
  _.extendOwn = _.assign = createAssigner(_.keys);

  // Returns the first key on an object that passes a predicate test
  _.findKey = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = _.keys(obj), key;
    for (var i = 0, length = keys.length; i < length; i++) {
      key = keys[i];
      if (predicate(obj[key], key, obj)) return key;
    }
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(object, oiteratee, context) {
    var result = {}, obj = object, iteratee, keys;
    if (obj == null) return result;
    if (_.isFunction(oiteratee)) {
      keys = _.allKeys(obj);
      iteratee = optimizeCb(oiteratee, context);
    } else {
      keys = flatten(arguments, false, false, 1);
      iteratee = function(value, key, obj) { return key in obj; };
      obj = Object(obj);
    }
    for (var i = 0, length = keys.length; i < length; i++) {
      var key = keys[i];
      var value = obj[key];
      if (iteratee(value, key, obj)) result[key] = value;
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(flatten(arguments, false, false, 1), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = createAssigner(_.allKeys, true);

  // Creates an object that inherits from the given prototype object.
  // If additional properties are provided then they will be added to the
  // created object.
  _.create = function(prototype, props) {
    var result = baseCreate(prototype);
    if (props) _.extendOwn(result, props);
    return result;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Returns whether an object has a given set of `key:value` pairs.
  _.isMatch = function(object, attrs) {
    var keys = _.keys(attrs), length = keys.length;
    if (object == null) return !length;
    var obj = Object(object);
    for (var i = 0; i < length; i++) {
      var key = keys[i];
      if (attrs[key] !== obj[key] || !(key in obj)) return false;
    }
    return true;
  };


  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }

    var areArrays = className === '[object Array]';
    if (!areArrays) {
      if (typeof a != 'object' || typeof b != 'object') return false;

      // Objects with different constructors are not equivalent, but `Object`s or `Array`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
                               _.isFunction(bCtor) && bCtor instanceof bCtor)
                          && ('constructor' in a && 'constructor' in b)) {
        return false;
      }
    }
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.

    // Initializing stack of traversed objects.
    // It's done here since we only need them for objects and arrays comparison.
    aStack = aStack || [];
    bStack = bStack || [];
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }

    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);

    // Recursively compare objects and arrays.
    if (areArrays) {
      // Compare array lengths to determine if a deep comparison is necessary.
      length = a.length;
      if (length !== b.length) return false;
      // Deep compare the contents, ignoring non-numeric properties.
      while (length--) {
        if (!eq(a[length], b[length], aStack, bStack)) return false;
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      length = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      if (_.keys(b).length !== length) return false;
      while (length--) {
        // Deep compare each member
        key = keys[length];
        if (!(_.has(b, key) && eq(a[key], b[key], aStack, bStack))) return false;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return true;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (isArrayLike(obj) && (_.isArray(obj) || _.isString(obj) || _.isArguments(obj))) return obj.length === 0;
    return _.keys(obj).length === 0;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp, isError.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp', 'Error'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE < 9), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around some typeof bugs in old v8,
  // IE 11 (#1621), and in Safari 8 (#1929).
  if (typeof /./ != 'function' && typeof Int8Array != 'object') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  // Predicate-generating functions. Often useful outside of Underscore.
  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = property;

  // Generates a function for a given object that returns a given property.
  _.propertyOf = function(obj) {
    return obj == null ? function(){} : function(key) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of
  // `key:value` pairs.
  _.matcher = _.matches = function(attrs) {
    attrs = _.extendOwn({}, attrs);
    return function(obj) {
      return _.isMatch(obj, attrs);
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = optimizeCb(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property, fallback) {
    var value = object == null ? void 0 : object[property];
    if (value === void 0) {
      value = fallback;
    }
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(instance, obj) {
    return instance._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // Provide unwrapping proxy for some methods used in engine operations
  // such as arithmetic and JSON stringification.
  _.prototype.valueOf = _.prototype.toJSON = _.prototype.value;

  _.prototype.toString = function() {
    return '' + this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (typeof define === 'function' && define.amd) {
    define('underscore', [], function() {
      return _;
    });
  }
}.call(this));

},{}],40:[function(_dereq_,module,exports){
var bundleFn = arguments[3];
var sources = arguments[4];
var cache = arguments[5];

var stringify = JSON.stringify;

module.exports = function (fn) {
    var keys = [];
    var wkey;
    var cacheKeys = Object.keys(cache);

    for (var i = 0, l = cacheKeys.length; i < l; i++) {
        var key = cacheKeys[i];
        var exp = cache[key].exports;
        // Using babel as a transpiler to use esmodule, the export will always
        // be an object with the default export as a property of it. To ensure
        // the existing api and babel esmodule exports are both supported we
        // check for both
        if (exp === fn || exp.default === fn) {
            wkey = key;
            break;
        }
    }

    if (!wkey) {
        wkey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
        var wcache = {};
        for (var i = 0, l = cacheKeys.length; i < l; i++) {
            var key = cacheKeys[i];
            wcache[key] = key;
        }
        sources[wkey] = [
            Function(['require','module','exports'], '(' + fn + ')(self)'),
            wcache
        ];
    }
    var skey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);

    var scache = {}; scache[wkey] = wkey;
    sources[skey] = [
        Function(['require'], (
            // try to call default if defined to also support babel esmodule
            // exports
            'var f = require(' + stringify(wkey) + ');' +
            '(f.default ? f.default : f)(self);'
        )),
        scache
    ];

    var src = '(' + bundleFn + ')({'
        + Object.keys(sources).map(function (key) {
            return stringify(key) + ':['
                + sources[key][0]
                + ',' + stringify(sources[key][1]) + ']'
            ;
        }).join(',')
        + '},{},[' + stringify(skey) + '])'
    ;

    var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

    return new Worker(URL.createObjectURL(
        new Blob([src], { type: 'text/javascript' })
    ));
};

},{}],41:[function(_dereq_,module,exports){
'use strict';

var Graph = _dereq_('ngraph.graph');
var _ = _dereq_('underscore');
var Q = _dereq_('Q');
var Nlayout = _dereq_('ngraph.asyncforce');
// registers the extension on a cytoscape lib ref

var ngraph = function (cytoscape) {

    if (!cytoscape) {
        return;
    } // can't register if cytoscape unspecified

    var defaults = {
        async: {
            // tell layout that we want to compute all at once:
            maxIterations: 1000,
            stepsPerCycle: 30,

            // Run it till the end:
            waitForStep: false
        },
        physics: {
            /**
             * Ideal length for links (springs in physical model).
             */
            springLength: 100,

            /**
             * Hook's law coefficient. 1 - solid spring.
             */
            springCoeff: 0.0008,

            /**
             * Coulomb's law coefficient. It's used to repel nodes thus should be negative
             * if you make it positive nodes start attract each other :).
             */
            gravity: -1.2,

            /**
             * Theta coefficient from Barnes Hut simulation. Ranged between (0, 1).
             * The closer it's to 1 the more nodes algorithm will have to go through.
             * Setting it to one makes Barnes Hut simulation no different from
             * brute-force forces calculation (each node is considered).
             */
            theta: 0.8,

            /**
             * Drag force coefficient. Used to slow down system, thus should be less than 1.
             * The closer it is to 0 the less tight system will be.
             */
            dragCoeff: 0.02,

            /**
             * Default time step (dt) for forces integration
             */
            timeStep: 20,
            iterations: 10000,
            fit: true,

            /**
             * Maximum movement of the system which can be considered as stabilized
             */
            stableThreshold: 0.000009
        },
        iterations: 10000,
        refreshInterval: 16, // in ms
        refreshIterations: 10, // iterations until thread sends an update
        stableThreshold: 2,
        animate: true,
        fit: true
    };

    var extend = Object.assign || function (tgt) {
        for (var i = 1; i < arguments.length; i++) {
            var obj = arguments[i];

            for (var k in obj) {
                tgt[k] = obj[k];
            }
        }
        return tgt;
    };

    function Layout(options) {
        this.options = extend({}, defaults, options);
        this.layoutOptions = extend({}, defaults, options);
        delete this.layoutOptions.cy;
        delete this.layoutOptions.eles;
    }

    Layout.prototype.l = Nlayout;
    Layout.prototype.g = Graph;

    Layout.prototype.run = function () {
        var layout = this;
        layout.trigger({ type: 'layoutstart', layout: layout });
        var options = this.options;
        var layoutOptions = this.layoutOptions;
        var that = this;
        var graph = that.g();
        var cy = options.cy;
        var eles = options.eles;
        var nodes = eles.nodes();
        var parents = nodes.parents();

        // FILTER

        nodes = nodes.difference(parents);

        nodes = nodes.filterFn(function (ele) {
            return ele.connectedEdges().length > 0
        });

        var edges = eles.edges();
        var edgesHash = {};
        var L;


        var firstUpdate = true;

        /*        if (eles.length > 3000) {
         options.iterations = options.iterations - Math.abs(options.iterations / 3); // reduce iterations for big graph
         }*/

        var update = function (nodesJson) {
            /* cy.batch(function () {
             nodesJson.forEach(function(e,k){
             nodes.$('#'+ e.data.id).position(e.position);
             })

             });*/
            nodes.positions(function (i, node) {
                if (typeof i != 'number') {
                    var tmp = i;
                    i = node;
                    node = tmp;
                }
                if (!node.data('dragging'))
                    return L.getNodePosition(node.id())
            });

            if (layoutOptions.async) {
                setTimeout(function () {
                    layout.trigger({ type: 'layoutstop', layout: layout });
                    layout.trigger({ type: 'layoutready', layout: layout });
                }, 500);
            }

            /* nodes.forEach(function (node) {
             L.getNodePosition(node.id())
             });*/

            // maybe we fit each iteration
            if (layoutOptions.fit) {
                cy.fit(layoutOptions.padding);
            }

            if (firstUpdate) {
                // indicate the initial positions have been set
                layout.trigger('layoutready');
                firstUpdate = false;
            }

        };

        graph.on('changed', function (e) {
            //  console.dir(e);
        });

        _.each(nodes, function (e, k) {
            e.on('tapstart', function (e) {
                e.cyTarget.data('dragging', true)
            });
            e.on('tapend', function (e) {
                e.cyTarget.removeData('dragging');
            });
            e.on('position', 'node[dragging]', function (e) {
                if (L.setNodePosition && e.cyTarget.data('dragging')) {
                    L.setNodePosition(e.cyTarget.data().id);
                }
            });
            graph.addNode(e.data().id);
        });

        _.each(edges, function (e, k) {
            if (!edgesHash[e.data().source + ':' + e.data().target] && !edgesHash[e.data().target + ':' + e.data().source]) {
                edgesHash[e.data().source + ':' + e.data().target] = e;
                graph.addLink(e.data().source, e.data().target);
            }
        });

        L = that.l(graph, layoutOptions);

        _.each(nodes, function (e, k) {
            var data = e.data();
            //var pos = e.position();
            if (data.pin) {
                L.pinNode(data.id, true);
                e.removeData('pin');
                e.data('unpin', true);
            } else if (data.unpin) {
                L.pinNode(data.id, false);
                e.removeData('unpin');
            }
            //if (pos.x && pos.y) {
            //  L.setNodePosition(data.id, pos);
            //}
        });

        var left = layoutOptions.iterations;

        this.on('layoutstop', function () {
            layoutOptions.iterations = 0;
        });

        L.on('stable', function () {
            console.log('got Stable event');
            left = 0;
        });

        if (!layoutOptions.animate) {
            layoutOptions.refreshInterval = 0;
        }
        var updateTimeout;
        L.on('cycle', function () {
            update();
            if (!layoutOptions.animate) {
                step();
            }
        });

        // if (layoutOptions.async) {
        //     return this;
        // }

        var step = function () {
            if (layoutOptions.animate) {
                if (left != 0  /*condition for stopping layout*/) {
                    if (!updateTimeout || left == 0) {
                        updateTimeout = setTimeout(function () {
                            left--;
                            //update();
                            updateTimeout = null;
                            L.step() ? left = 0 : false;
                            if (!left) {
                                update();
                            }
                            step();
                            //step();
                        }, layoutOptions.refreshInterval);
                    }
                } else {
                    layout.trigger({ type: 'layoutstop', layout: layout });
                    layout.trigger({ type: 'layoutready', layout: layout });
                }
            } else {

                for (var i = 0; i < layoutOptions.iterations; i++) {
                    L.step()
                }
                layout.trigger({ type: 'layoutstop', layout: layout });
                layout.trigger({ type: 'layoutready', layout: layout });
                //update();
            }

        };
        step();
        return this;
    };

    Layout.prototype.stop = function () {
        // TODO: thread actions
        // continuous/asynchronous layout may want to set a flag etc to let
        // run() know to stop


        if (this.thread) {
            this.thread.stop();
        }

        this.trigger('layoutstop');

        return this; // chaining
    };

    Layout.prototype.destroy = function () {
        // clean up here if you create threads etc
        // TODO: thread actions

        if (this.thread) {
            this.thread.stop();
        }

        return this; // chaining
    };

    return Layout;

};

module.exports = function get(cytoscape) {
    return ngraph(cytoscape);
};

},{"Q":1,"ngraph.asyncforce":2,"ngraph.graph":24,"underscore":39}],42:[function(_dereq_,module,exports){
'use strict';

(function(){

    // registers the extension on a cytoscape lib ref
    var getLayout = _dereq_('./impl.js');
    var register = function( cytoscape ){
        var Layout = getLayout( cytoscape );
        cytoscape('layout', 'cytoscape-ngraph.forcelayout', Layout);
    };

    if( typeof module !== 'undefined' && module.exports ){ // expose as a commonjs module
        module.exports = register;
    }

    if( typeof define !== 'undefined' && define.amd ){ // expose as an amd/requirejs module
        define('cytoscape-ngraph.forcelayout', function(){
            return register;
        });
    }

    if( typeof cytoscape !== 'undefined' ){ // expose to global cytoscape (i.e. window.cytoscape)
        register( cytoscape );
    }

})();
},{"./impl.js":41}]},{},[42])(42)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvUS9xLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5hc3luY2ZvcmNlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5hc3luY2ZvcmNlL2xpYi9jcmVhdGVMYXlvdXQuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmFzeW5jZm9yY2UvbGliL2xheW91dFdvcmtlci5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguYXN5bmNmb3JjZS9saWIvbWVzc2FnZXMuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmFzeW5jZm9yY2Uvb3B0aW9ucy5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZXZlbnRzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5leHBvc2UvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmZvcmNlbGF5b3V0M2QvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmZvcmNlbGF5b3V0M2QvbGliL2JvdW5kcy5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZm9yY2VsYXlvdXQzZC9saWIvY3JlYXRlQm9keS5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZm9yY2VsYXlvdXQzZC9saWIvZHJhZ0ZvcmNlLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5mb3JjZWxheW91dDNkL2xpYi9ldWxlckludGVncmF0b3IuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmZvcmNlbGF5b3V0M2QvbGliL3NwcmluZ0ZvcmNlLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5mb3JjZWxheW91dC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZm9yY2VsYXlvdXQvbm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnNpbXVsYXRvci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZm9yY2VsYXlvdXQvbm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnNpbXVsYXRvci9saWIvYm91bmRzLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5mb3JjZWxheW91dC9ub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9jcmVhdGVCb2R5LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5mb3JjZWxheW91dC9ub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9kcmFnRm9yY2UuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmZvcmNlbGF5b3V0L25vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IvbGliL2V1bGVySW50ZWdyYXRvci5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZm9yY2VsYXlvdXQvbm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnNpbXVsYXRvci9saWIvc3ByaW5nLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5mb3JjZWxheW91dC9ub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9zcHJpbmdGb3JjZS5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZnJvbWpzb24vaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmdyYXBoL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5tZXJnZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5wcmltaXRpdmVzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5xdWFkdHJlZWJoM2QvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnF1YWR0cmVlYmgzZC9pbnNlcnRTdGFjay5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaDNkL2lzU2FtZVBvc2l0aW9uLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5xdWFkdHJlZWJoM2Qvbm9kZS5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9pbnNlcnRTdGFjay5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9pc1NhbWVQb3NpdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9ub2RlLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5yYW5kb20vaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnRvanNvbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvdW5kZXJzY29yZS91bmRlcnNjb3JlLmpzIiwibm9kZV9tb2R1bGVzL3dlYndvcmtpZnkvaW5kZXguanMiLCJzcmMvaW1wbC5qcyIsInNyYy9pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoZ0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeklBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3REQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOVNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDamtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVnREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDalRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gdmltOnRzPTQ6c3RzPTQ6c3c9NDpcbi8qIVxuICpcbiAqIENvcHlyaWdodCAyMDA5LTIwMTIgS3JpcyBLb3dhbCB1bmRlciB0aGUgdGVybXMgb2YgdGhlIE1JVFxuICogbGljZW5zZSBmb3VuZCBhdCBodHRwOi8vZ2l0aHViLmNvbS9rcmlza293YWwvcS9yYXcvbWFzdGVyL0xJQ0VOU0VcbiAqXG4gKiBXaXRoIHBhcnRzIGJ5IFR5bGVyIENsb3NlXG4gKiBDb3B5cmlnaHQgMjAwNy0yMDA5IFR5bGVyIENsb3NlIHVuZGVyIHRoZSB0ZXJtcyBvZiB0aGUgTUlUIFggbGljZW5zZSBmb3VuZFxuICogYXQgaHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9taXQtbGljZW5zZS5odG1sXG4gKiBGb3JrZWQgYXQgcmVmX3NlbmQuanMgdmVyc2lvbjogMjAwOS0wNS0xMVxuICpcbiAqIFdpdGggcGFydHMgYnkgTWFyayBNaWxsZXJcbiAqIENvcHlyaWdodCAoQykgMjAxMSBHb29nbGUgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICpcbiAqL1xuXG4oZnVuY3Rpb24gKGRlZmluaXRpb24pIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIC8vIFRoaXMgZmlsZSB3aWxsIGZ1bmN0aW9uIHByb3Blcmx5IGFzIGEgPHNjcmlwdD4gdGFnLCBvciBhIG1vZHVsZVxuICAgIC8vIHVzaW5nIENvbW1vbkpTIGFuZCBOb2RlSlMgb3IgUmVxdWlyZUpTIG1vZHVsZSBmb3JtYXRzLiAgSW5cbiAgICAvLyBDb21tb24vTm9kZS9SZXF1aXJlSlMsIHRoZSBtb2R1bGUgZXhwb3J0cyB0aGUgUSBBUEkgYW5kIHdoZW5cbiAgICAvLyBleGVjdXRlZCBhcyBhIHNpbXBsZSA8c2NyaXB0PiwgaXQgY3JlYXRlcyBhIFEgZ2xvYmFsIGluc3RlYWQuXG5cbiAgICAvLyBNb250YWdlIFJlcXVpcmVcbiAgICBpZiAodHlwZW9mIGJvb3RzdHJhcCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGJvb3RzdHJhcChcInByb21pc2VcIiwgZGVmaW5pdGlvbik7XG5cbiAgICAvLyBDb21tb25KU1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGV4cG9ydHMgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIG1vZHVsZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IGRlZmluaXRpb24oKTtcblxuICAgIC8vIFJlcXVpcmVKU1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gXCJmdW5jdGlvblwiICYmIGRlZmluZS5hbWQpIHtcbiAgICAgICAgZGVmaW5lKGRlZmluaXRpb24pO1xuXG4gICAgLy8gU0VTIChTZWN1cmUgRWNtYVNjcmlwdClcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzZXMgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgaWYgKCFzZXMub2soKSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc2VzLm1ha2VRID0gZGVmaW5pdGlvbjtcbiAgICAgICAgfVxuXG4gICAgLy8gPHNjcmlwdD5cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgfHwgdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAgICAgLy8gUHJlZmVyIHdpbmRvdyBvdmVyIHNlbGYgZm9yIGFkZC1vbiBzY3JpcHRzLiBVc2Ugc2VsZiBmb3JcbiAgICAgICAgLy8gbm9uLXdpbmRvd2VkIGNvbnRleHRzLlxuICAgICAgICB2YXIgZ2xvYmFsID0gdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHNlbGY7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBgd2luZG93YCBvYmplY3QsIHNhdmUgdGhlIHByZXZpb3VzIFEgZ2xvYmFsXG4gICAgICAgIC8vIGFuZCBpbml0aWFsaXplIFEgYXMgYSBnbG9iYWwuXG4gICAgICAgIHZhciBwcmV2aW91c1EgPSBnbG9iYWwuUTtcbiAgICAgICAgZ2xvYmFsLlEgPSBkZWZpbml0aW9uKCk7XG5cbiAgICAgICAgLy8gQWRkIGEgbm9Db25mbGljdCBmdW5jdGlvbiBzbyBRIGNhbiBiZSByZW1vdmVkIGZyb20gdGhlXG4gICAgICAgIC8vIGdsb2JhbCBuYW1lc3BhY2UuXG4gICAgICAgIGdsb2JhbC5RLm5vQ29uZmxpY3QgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBnbG9iYWwuUSA9IHByZXZpb3VzUTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9O1xuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVGhpcyBlbnZpcm9ubWVudCB3YXMgbm90IGFudGljaXBhdGVkIGJ5IFEuIFBsZWFzZSBmaWxlIGEgYnVnLlwiKTtcbiAgICB9XG5cbn0pKGZ1bmN0aW9uICgpIHtcblwidXNlIHN0cmljdFwiO1xuXG52YXIgaGFzU3RhY2tzID0gZmFsc2U7XG50cnkge1xuICAgIHRocm93IG5ldyBFcnJvcigpO1xufSBjYXRjaCAoZSkge1xuICAgIGhhc1N0YWNrcyA9ICEhZS5zdGFjaztcbn1cblxuLy8gQWxsIGNvZGUgYWZ0ZXIgdGhpcyBwb2ludCB3aWxsIGJlIGZpbHRlcmVkIGZyb20gc3RhY2sgdHJhY2VzIHJlcG9ydGVkXG4vLyBieSBRLlxudmFyIHFTdGFydGluZ0xpbmUgPSBjYXB0dXJlTGluZSgpO1xudmFyIHFGaWxlTmFtZTtcblxuLy8gc2hpbXNcblxuLy8gdXNlZCBmb3IgZmFsbGJhY2sgaW4gXCJhbGxSZXNvbHZlZFwiXG52YXIgbm9vcCA9IGZ1bmN0aW9uICgpIHt9O1xuXG4vLyBVc2UgdGhlIGZhc3Rlc3QgcG9zc2libGUgbWVhbnMgdG8gZXhlY3V0ZSBhIHRhc2sgaW4gYSBmdXR1cmUgdHVyblxuLy8gb2YgdGhlIGV2ZW50IGxvb3AuXG52YXIgbmV4dFRpY2sgPShmdW5jdGlvbiAoKSB7XG4gICAgLy8gbGlua2VkIGxpc3Qgb2YgdGFza3MgKHNpbmdsZSwgd2l0aCBoZWFkIG5vZGUpXG4gICAgdmFyIGhlYWQgPSB7dGFzazogdm9pZCAwLCBuZXh0OiBudWxsfTtcbiAgICB2YXIgdGFpbCA9IGhlYWQ7XG4gICAgdmFyIGZsdXNoaW5nID0gZmFsc2U7XG4gICAgdmFyIHJlcXVlc3RUaWNrID0gdm9pZCAwO1xuICAgIHZhciBpc05vZGVKUyA9IGZhbHNlO1xuICAgIC8vIHF1ZXVlIGZvciBsYXRlIHRhc2tzLCB1c2VkIGJ5IHVuaGFuZGxlZCByZWplY3Rpb24gdHJhY2tpbmdcbiAgICB2YXIgbGF0ZXJRdWV1ZSA9IFtdO1xuXG4gICAgZnVuY3Rpb24gZmx1c2goKSB7XG4gICAgICAgIC8qIGpzaGludCBsb29wZnVuYzogdHJ1ZSAqL1xuICAgICAgICB2YXIgdGFzaywgZG9tYWluO1xuXG4gICAgICAgIHdoaWxlIChoZWFkLm5leHQpIHtcbiAgICAgICAgICAgIGhlYWQgPSBoZWFkLm5leHQ7XG4gICAgICAgICAgICB0YXNrID0gaGVhZC50YXNrO1xuICAgICAgICAgICAgaGVhZC50YXNrID0gdm9pZCAwO1xuICAgICAgICAgICAgZG9tYWluID0gaGVhZC5kb21haW47XG5cbiAgICAgICAgICAgIGlmIChkb21haW4pIHtcbiAgICAgICAgICAgICAgICBoZWFkLmRvbWFpbiA9IHZvaWQgMDtcbiAgICAgICAgICAgICAgICBkb21haW4uZW50ZXIoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJ1blNpbmdsZSh0YXNrLCBkb21haW4pO1xuXG4gICAgICAgIH1cbiAgICAgICAgd2hpbGUgKGxhdGVyUXVldWUubGVuZ3RoKSB7XG4gICAgICAgICAgICB0YXNrID0gbGF0ZXJRdWV1ZS5wb3AoKTtcbiAgICAgICAgICAgIHJ1blNpbmdsZSh0YXNrKTtcbiAgICAgICAgfVxuICAgICAgICBmbHVzaGluZyA9IGZhbHNlO1xuICAgIH1cbiAgICAvLyBydW5zIGEgc2luZ2xlIGZ1bmN0aW9uIGluIHRoZSBhc3luYyBxdWV1ZVxuICAgIGZ1bmN0aW9uIHJ1blNpbmdsZSh0YXNrLCBkb21haW4pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRhc2soKTtcblxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBpZiAoaXNOb2RlSlMpIHtcbiAgICAgICAgICAgICAgICAvLyBJbiBub2RlLCB1bmNhdWdodCBleGNlcHRpb25zIGFyZSBjb25zaWRlcmVkIGZhdGFsIGVycm9ycy5cbiAgICAgICAgICAgICAgICAvLyBSZS10aHJvdyB0aGVtIHN5bmNocm9ub3VzbHkgdG8gaW50ZXJydXB0IGZsdXNoaW5nIVxuXG4gICAgICAgICAgICAgICAgLy8gRW5zdXJlIGNvbnRpbnVhdGlvbiBpZiB0aGUgdW5jYXVnaHQgZXhjZXB0aW9uIGlzIHN1cHByZXNzZWRcbiAgICAgICAgICAgICAgICAvLyBsaXN0ZW5pbmcgXCJ1bmNhdWdodEV4Y2VwdGlvblwiIGV2ZW50cyAoYXMgZG9tYWlucyBkb2VzKS5cbiAgICAgICAgICAgICAgICAvLyBDb250aW51ZSBpbiBuZXh0IGV2ZW50IHRvIGF2b2lkIHRpY2sgcmVjdXJzaW9uLlxuICAgICAgICAgICAgICAgIGlmIChkb21haW4pIHtcbiAgICAgICAgICAgICAgICAgICAgZG9tYWluLmV4aXQoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmbHVzaCwgMCk7XG4gICAgICAgICAgICAgICAgaWYgKGRvbWFpbikge1xuICAgICAgICAgICAgICAgICAgICBkb21haW4uZW50ZXIoKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIEluIGJyb3dzZXJzLCB1bmNhdWdodCBleGNlcHRpb25zIGFyZSBub3QgZmF0YWwuXG4gICAgICAgICAgICAgICAgLy8gUmUtdGhyb3cgdGhlbSBhc3luY2hyb25vdXNseSB0byBhdm9pZCBzbG93LWRvd25zLlxuICAgICAgICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGRvbWFpbikge1xuICAgICAgICAgICAgZG9tYWluLmV4aXQoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIG5leHRUaWNrID0gZnVuY3Rpb24gKHRhc2spIHtcbiAgICAgICAgdGFpbCA9IHRhaWwubmV4dCA9IHtcbiAgICAgICAgICAgIHRhc2s6IHRhc2ssXG4gICAgICAgICAgICBkb21haW46IGlzTm9kZUpTICYmIHByb2Nlc3MuZG9tYWluLFxuICAgICAgICAgICAgbmV4dDogbnVsbFxuICAgICAgICB9O1xuXG4gICAgICAgIGlmICghZmx1c2hpbmcpIHtcbiAgICAgICAgICAgIGZsdXNoaW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlcXVlc3RUaWNrKCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgaWYgKHR5cGVvZiBwcm9jZXNzID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHByb2Nlc3MudG9TdHJpbmcoKSA9PT0gXCJbb2JqZWN0IHByb2Nlc3NdXCIgJiYgcHJvY2Vzcy5uZXh0VGljaykge1xuICAgICAgICAvLyBFbnN1cmUgUSBpcyBpbiBhIHJlYWwgTm9kZSBlbnZpcm9ubWVudCwgd2l0aCBhIGBwcm9jZXNzLm5leHRUaWNrYC5cbiAgICAgICAgLy8gVG8gc2VlIHRocm91Z2ggZmFrZSBOb2RlIGVudmlyb25tZW50czpcbiAgICAgICAgLy8gKiBNb2NoYSB0ZXN0IHJ1bm5lciAtIGV4cG9zZXMgYSBgcHJvY2Vzc2AgZ2xvYmFsIHdpdGhvdXQgYSBgbmV4dFRpY2tgXG4gICAgICAgIC8vICogQnJvd3NlcmlmeSAtIGV4cG9zZXMgYSBgcHJvY2Vzcy5uZXhUaWNrYCBmdW5jdGlvbiB0aGF0IHVzZXNcbiAgICAgICAgLy8gICBgc2V0VGltZW91dGAuIEluIHRoaXMgY2FzZSBgc2V0SW1tZWRpYXRlYCBpcyBwcmVmZXJyZWQgYmVjYXVzZVxuICAgICAgICAvLyAgICBpdCBpcyBmYXN0ZXIuIEJyb3dzZXJpZnkncyBgcHJvY2Vzcy50b1N0cmluZygpYCB5aWVsZHNcbiAgICAgICAgLy8gICBcIltvYmplY3QgT2JqZWN0XVwiLCB3aGlsZSBpbiBhIHJlYWwgTm9kZSBlbnZpcm9ubWVudFxuICAgICAgICAvLyAgIGBwcm9jZXNzLm5leHRUaWNrKClgIHlpZWxkcyBcIltvYmplY3QgcHJvY2Vzc11cIi5cbiAgICAgICAgaXNOb2RlSlMgPSB0cnVlO1xuXG4gICAgICAgIHJlcXVlc3RUaWNrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcHJvY2Vzcy5uZXh0VGljayhmbHVzaCk7XG4gICAgICAgIH07XG5cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBzZXRJbW1lZGlhdGUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAvLyBJbiBJRTEwLCBOb2RlLmpzIDAuOSssIG9yIGh0dHBzOi8vZ2l0aHViLmNvbS9Ob2JsZUpTL3NldEltbWVkaWF0ZVxuICAgICAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgcmVxdWVzdFRpY2sgPSBzZXRJbW1lZGlhdGUuYmluZCh3aW5kb3csIGZsdXNoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlcXVlc3RUaWNrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHNldEltbWVkaWF0ZShmbHVzaCk7XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBNZXNzYWdlQ2hhbm5lbCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAvLyBtb2Rlcm4gYnJvd3NlcnNcbiAgICAgICAgLy8gaHR0cDovL3d3dy5ub25ibG9ja2luZy5pby8yMDExLzA2L3dpbmRvd25leHR0aWNrLmh0bWxcbiAgICAgICAgdmFyIGNoYW5uZWwgPSBuZXcgTWVzc2FnZUNoYW5uZWwoKTtcbiAgICAgICAgLy8gQXQgbGVhc3QgU2FmYXJpIFZlcnNpb24gNi4wLjUgKDg1MzYuMzAuMSkgaW50ZXJtaXR0ZW50bHkgY2Fubm90IGNyZWF0ZVxuICAgICAgICAvLyB3b3JraW5nIG1lc3NhZ2UgcG9ydHMgdGhlIGZpcnN0IHRpbWUgYSBwYWdlIGxvYWRzLlxuICAgICAgICBjaGFubmVsLnBvcnQxLm9ubWVzc2FnZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJlcXVlc3RUaWNrID0gcmVxdWVzdFBvcnRUaWNrO1xuICAgICAgICAgICAgY2hhbm5lbC5wb3J0MS5vbm1lc3NhZ2UgPSBmbHVzaDtcbiAgICAgICAgICAgIGZsdXNoKCk7XG4gICAgICAgIH07XG4gICAgICAgIHZhciByZXF1ZXN0UG9ydFRpY2sgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAvLyBPcGVyYSByZXF1aXJlcyB1cyB0byBwcm92aWRlIGEgbWVzc2FnZSBwYXlsb2FkLCByZWdhcmRsZXNzIG9mXG4gICAgICAgICAgICAvLyB3aGV0aGVyIHdlIHVzZSBpdC5cbiAgICAgICAgICAgIGNoYW5uZWwucG9ydDIucG9zdE1lc3NhZ2UoMCk7XG4gICAgICAgIH07XG4gICAgICAgIHJlcXVlc3RUaWNrID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgc2V0VGltZW91dChmbHVzaCwgMCk7XG4gICAgICAgICAgICByZXF1ZXN0UG9ydFRpY2soKTtcbiAgICAgICAgfTtcblxuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG9sZCBicm93c2Vyc1xuICAgICAgICByZXF1ZXN0VGljayA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoZmx1c2gsIDApO1xuICAgICAgICB9O1xuICAgIH1cbiAgICAvLyBydW5zIGEgdGFzayBhZnRlciBhbGwgb3RoZXIgdGFza3MgaGF2ZSBiZWVuIHJ1blxuICAgIC8vIHRoaXMgaXMgdXNlZnVsIGZvciB1bmhhbmRsZWQgcmVqZWN0aW9uIHRyYWNraW5nIHRoYXQgbmVlZHMgdG8gaGFwcGVuXG4gICAgLy8gYWZ0ZXIgYWxsIGB0aGVuYGQgdGFza3MgaGF2ZSBiZWVuIHJ1bi5cbiAgICBuZXh0VGljay5ydW5BZnRlciA9IGZ1bmN0aW9uICh0YXNrKSB7XG4gICAgICAgIGxhdGVyUXVldWUucHVzaCh0YXNrKTtcbiAgICAgICAgaWYgKCFmbHVzaGluZykge1xuICAgICAgICAgICAgZmx1c2hpbmcgPSB0cnVlO1xuICAgICAgICAgICAgcmVxdWVzdFRpY2soKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgcmV0dXJuIG5leHRUaWNrO1xufSkoKTtcblxuLy8gQXR0ZW1wdCB0byBtYWtlIGdlbmVyaWNzIHNhZmUgaW4gdGhlIGZhY2Ugb2YgZG93bnN0cmVhbVxuLy8gbW9kaWZpY2F0aW9ucy5cbi8vIFRoZXJlIGlzIG5vIHNpdHVhdGlvbiB3aGVyZSB0aGlzIGlzIG5lY2Vzc2FyeS5cbi8vIElmIHlvdSBuZWVkIGEgc2VjdXJpdHkgZ3VhcmFudGVlLCB0aGVzZSBwcmltb3JkaWFscyBuZWVkIHRvIGJlXG4vLyBkZWVwbHkgZnJvemVuIGFueXdheSwgYW5kIGlmIHlvdSBkb27igJl0IG5lZWQgYSBzZWN1cml0eSBndWFyYW50ZWUsXG4vLyB0aGlzIGlzIGp1c3QgcGxhaW4gcGFyYW5vaWQuXG4vLyBIb3dldmVyLCB0aGlzICoqbWlnaHQqKiBoYXZlIHRoZSBuaWNlIHNpZGUtZWZmZWN0IG9mIHJlZHVjaW5nIHRoZSBzaXplIG9mXG4vLyB0aGUgbWluaWZpZWQgY29kZSBieSByZWR1Y2luZyB4LmNhbGwoKSB0byBtZXJlbHkgeCgpXG4vLyBTZWUgTWFyayBNaWxsZXLigJlzIGV4cGxhbmF0aW9uIG9mIHdoYXQgdGhpcyBkb2VzLlxuLy8gaHR0cDovL3dpa2kuZWNtYXNjcmlwdC5vcmcvZG9rdS5waHA/aWQ9Y29udmVudGlvbnM6c2FmZV9tZXRhX3Byb2dyYW1taW5nXG52YXIgY2FsbCA9IEZ1bmN0aW9uLmNhbGw7XG5mdW5jdGlvbiB1bmN1cnJ5VGhpcyhmKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIGNhbGwuYXBwbHkoZiwgYXJndW1lbnRzKTtcbiAgICB9O1xufVxuLy8gVGhpcyBpcyBlcXVpdmFsZW50LCBidXQgc2xvd2VyOlxuLy8gdW5jdXJyeVRoaXMgPSBGdW5jdGlvbl9iaW5kLmJpbmQoRnVuY3Rpb25fYmluZC5jYWxsKTtcbi8vIGh0dHA6Ly9qc3BlcmYuY29tL3VuY3Vycnl0aGlzXG5cbnZhciBhcnJheV9zbGljZSA9IHVuY3VycnlUaGlzKEFycmF5LnByb3RvdHlwZS5zbGljZSk7XG5cbnZhciBhcnJheV9yZWR1Y2UgPSB1bmN1cnJ5VGhpcyhcbiAgICBBcnJheS5wcm90b3R5cGUucmVkdWNlIHx8IGZ1bmN0aW9uIChjYWxsYmFjaywgYmFzaXMpIHtcbiAgICAgICAgdmFyIGluZGV4ID0gMCxcbiAgICAgICAgICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoO1xuICAgICAgICAvLyBjb25jZXJuaW5nIHRoZSBpbml0aWFsIHZhbHVlLCBpZiBvbmUgaXMgbm90IHByb3ZpZGVkXG4gICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICAvLyBzZWVrIHRvIHRoZSBmaXJzdCB2YWx1ZSBpbiB0aGUgYXJyYXksIGFjY291bnRpbmdcbiAgICAgICAgICAgIC8vIGZvciB0aGUgcG9zc2liaWxpdHkgdGhhdCBpcyBpcyBhIHNwYXJzZSBhcnJheVxuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICAgIGlmIChpbmRleCBpbiB0aGlzKSB7XG4gICAgICAgICAgICAgICAgICAgIGJhc2lzID0gdGhpc1tpbmRleCsrXTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICgrK2luZGV4ID49IGxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSB3aGlsZSAoMSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gcmVkdWNlXG4gICAgICAgIGZvciAoOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICAgICAgLy8gYWNjb3VudCBmb3IgdGhlIHBvc3NpYmlsaXR5IHRoYXQgdGhlIGFycmF5IGlzIHNwYXJzZVxuICAgICAgICAgICAgaWYgKGluZGV4IGluIHRoaXMpIHtcbiAgICAgICAgICAgICAgICBiYXNpcyA9IGNhbGxiYWNrKGJhc2lzLCB0aGlzW2luZGV4XSwgaW5kZXgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBiYXNpcztcbiAgICB9XG4pO1xuXG52YXIgYXJyYXlfaW5kZXhPZiA9IHVuY3VycnlUaGlzKFxuICAgIEFycmF5LnByb3RvdHlwZS5pbmRleE9mIHx8IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAvLyBub3QgYSB2ZXJ5IGdvb2Qgc2hpbSwgYnV0IGdvb2QgZW5vdWdoIGZvciBvdXIgb25lIHVzZSBvZiBpdFxuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmICh0aGlzW2ldID09PSB2YWx1ZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiAtMTtcbiAgICB9XG4pO1xuXG52YXIgYXJyYXlfbWFwID0gdW5jdXJyeVRoaXMoXG4gICAgQXJyYXkucHJvdG90eXBlLm1hcCB8fCBmdW5jdGlvbiAoY2FsbGJhY2ssIHRoaXNwKSB7XG4gICAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgICAgdmFyIGNvbGxlY3QgPSBbXTtcbiAgICAgICAgYXJyYXlfcmVkdWNlKHNlbGYsIGZ1bmN0aW9uICh1bmRlZmluZWQsIHZhbHVlLCBpbmRleCkge1xuICAgICAgICAgICAgY29sbGVjdC5wdXNoKGNhbGxiYWNrLmNhbGwodGhpc3AsIHZhbHVlLCBpbmRleCwgc2VsZikpO1xuICAgICAgICB9LCB2b2lkIDApO1xuICAgICAgICByZXR1cm4gY29sbGVjdDtcbiAgICB9XG4pO1xuXG52YXIgb2JqZWN0X2NyZWF0ZSA9IE9iamVjdC5jcmVhdGUgfHwgZnVuY3Rpb24gKHByb3RvdHlwZSkge1xuICAgIGZ1bmN0aW9uIFR5cGUoKSB7IH1cbiAgICBUeXBlLnByb3RvdHlwZSA9IHByb3RvdHlwZTtcbiAgICByZXR1cm4gbmV3IFR5cGUoKTtcbn07XG5cbnZhciBvYmplY3RfaGFzT3duUHJvcGVydHkgPSB1bmN1cnJ5VGhpcyhPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5KTtcblxudmFyIG9iamVjdF9rZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24gKG9iamVjdCkge1xuICAgIHZhciBrZXlzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iamVjdCkge1xuICAgICAgICBpZiAob2JqZWN0X2hhc093blByb3BlcnR5KG9iamVjdCwga2V5KSkge1xuICAgICAgICAgICAga2V5cy5wdXNoKGtleSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGtleXM7XG59O1xuXG52YXIgb2JqZWN0X3RvU3RyaW5nID0gdW5jdXJyeVRoaXMoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZyk7XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlID09PSBPYmplY3QodmFsdWUpO1xufVxuXG4vLyBnZW5lcmF0b3IgcmVsYXRlZCBzaGltc1xuXG4vLyBGSVhNRTogUmVtb3ZlIHRoaXMgZnVuY3Rpb24gb25jZSBFUzYgZ2VuZXJhdG9ycyBhcmUgaW4gU3BpZGVyTW9ua2V5LlxuZnVuY3Rpb24gaXNTdG9wSXRlcmF0aW9uKGV4Y2VwdGlvbikge1xuICAgIHJldHVybiAoXG4gICAgICAgIG9iamVjdF90b1N0cmluZyhleGNlcHRpb24pID09PSBcIltvYmplY3QgU3RvcEl0ZXJhdGlvbl1cIiB8fFxuICAgICAgICBleGNlcHRpb24gaW5zdGFuY2VvZiBRUmV0dXJuVmFsdWVcbiAgICApO1xufVxuXG4vLyBGSVhNRTogUmVtb3ZlIHRoaXMgaGVscGVyIGFuZCBRLnJldHVybiBvbmNlIEVTNiBnZW5lcmF0b3JzIGFyZSBpblxuLy8gU3BpZGVyTW9ua2V5LlxudmFyIFFSZXR1cm5WYWx1ZTtcbmlmICh0eXBlb2YgUmV0dXJuVmFsdWUgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBRUmV0dXJuVmFsdWUgPSBSZXR1cm5WYWx1ZTtcbn0gZWxzZSB7XG4gICAgUVJldHVyblZhbHVlID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZTtcbiAgICB9O1xufVxuXG4vLyBsb25nIHN0YWNrIHRyYWNlc1xuXG52YXIgU1RBQ0tfSlVNUF9TRVBBUkFUT1IgPSBcIkZyb20gcHJldmlvdXMgZXZlbnQ6XCI7XG5cbmZ1bmN0aW9uIG1ha2VTdGFja1RyYWNlTG9uZyhlcnJvciwgcHJvbWlzZSkge1xuICAgIC8vIElmIHBvc3NpYmxlLCB0cmFuc2Zvcm0gdGhlIGVycm9yIHN0YWNrIHRyYWNlIGJ5IHJlbW92aW5nIE5vZGUgYW5kIFFcbiAgICAvLyBjcnVmdCwgdGhlbiBjb25jYXRlbmF0aW5nIHdpdGggdGhlIHN0YWNrIHRyYWNlIG9mIGBwcm9taXNlYC4gU2VlICM1Ny5cbiAgICBpZiAoaGFzU3RhY2tzICYmXG4gICAgICAgIHByb21pc2Uuc3RhY2sgJiZcbiAgICAgICAgdHlwZW9mIGVycm9yID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIGVycm9yICE9PSBudWxsICYmXG4gICAgICAgIGVycm9yLnN0YWNrICYmXG4gICAgICAgIGVycm9yLnN0YWNrLmluZGV4T2YoU1RBQ0tfSlVNUF9TRVBBUkFUT1IpID09PSAtMVxuICAgICkge1xuICAgICAgICB2YXIgc3RhY2tzID0gW107XG4gICAgICAgIGZvciAodmFyIHAgPSBwcm9taXNlOyAhIXA7IHAgPSBwLnNvdXJjZSkge1xuICAgICAgICAgICAgaWYgKHAuc3RhY2spIHtcbiAgICAgICAgICAgICAgICBzdGFja3MudW5zaGlmdChwLnN0YWNrKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGFja3MudW5zaGlmdChlcnJvci5zdGFjayk7XG5cbiAgICAgICAgdmFyIGNvbmNhdGVkU3RhY2tzID0gc3RhY2tzLmpvaW4oXCJcXG5cIiArIFNUQUNLX0pVTVBfU0VQQVJBVE9SICsgXCJcXG5cIik7XG4gICAgICAgIGVycm9yLnN0YWNrID0gZmlsdGVyU3RhY2tTdHJpbmcoY29uY2F0ZWRTdGFja3MpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZmlsdGVyU3RhY2tTdHJpbmcoc3RhY2tTdHJpbmcpIHtcbiAgICB2YXIgbGluZXMgPSBzdGFja1N0cmluZy5zcGxpdChcIlxcblwiKTtcbiAgICB2YXIgZGVzaXJlZExpbmVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5lcy5sZW5ndGg7ICsraSkge1xuICAgICAgICB2YXIgbGluZSA9IGxpbmVzW2ldO1xuXG4gICAgICAgIGlmICghaXNJbnRlcm5hbEZyYW1lKGxpbmUpICYmICFpc05vZGVGcmFtZShsaW5lKSAmJiBsaW5lKSB7XG4gICAgICAgICAgICBkZXNpcmVkTGluZXMucHVzaChsaW5lKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZGVzaXJlZExpbmVzLmpvaW4oXCJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIGlzTm9kZUZyYW1lKHN0YWNrTGluZSkge1xuICAgIHJldHVybiBzdGFja0xpbmUuaW5kZXhPZihcIihtb2R1bGUuanM6XCIpICE9PSAtMSB8fFxuICAgICAgICAgICBzdGFja0xpbmUuaW5kZXhPZihcIihub2RlLmpzOlwiKSAhPT0gLTE7XG59XG5cbmZ1bmN0aW9uIGdldEZpbGVOYW1lQW5kTGluZU51bWJlcihzdGFja0xpbmUpIHtcbiAgICAvLyBOYW1lZCBmdW5jdGlvbnM6IFwiYXQgZnVuY3Rpb25OYW1lIChmaWxlbmFtZTpsaW5lTnVtYmVyOmNvbHVtbk51bWJlcilcIlxuICAgIC8vIEluIElFMTAgZnVuY3Rpb24gbmFtZSBjYW4gaGF2ZSBzcGFjZXMgKFwiQW5vbnltb3VzIGZ1bmN0aW9uXCIpIE9fb1xuICAgIHZhciBhdHRlbXB0MSA9IC9hdCAuKyBcXCgoLispOihcXGQrKTooPzpcXGQrKVxcKSQvLmV4ZWMoc3RhY2tMaW5lKTtcbiAgICBpZiAoYXR0ZW1wdDEpIHtcbiAgICAgICAgcmV0dXJuIFthdHRlbXB0MVsxXSwgTnVtYmVyKGF0dGVtcHQxWzJdKV07XG4gICAgfVxuXG4gICAgLy8gQW5vbnltb3VzIGZ1bmN0aW9uczogXCJhdCBmaWxlbmFtZTpsaW5lTnVtYmVyOmNvbHVtbk51bWJlclwiXG4gICAgdmFyIGF0dGVtcHQyID0gL2F0IChbXiBdKyk6KFxcZCspOig/OlxcZCspJC8uZXhlYyhzdGFja0xpbmUpO1xuICAgIGlmIChhdHRlbXB0Mikge1xuICAgICAgICByZXR1cm4gW2F0dGVtcHQyWzFdLCBOdW1iZXIoYXR0ZW1wdDJbMl0pXTtcbiAgICB9XG5cbiAgICAvLyBGaXJlZm94IHN0eWxlOiBcImZ1bmN0aW9uQGZpbGVuYW1lOmxpbmVOdW1iZXIgb3IgQGZpbGVuYW1lOmxpbmVOdW1iZXJcIlxuICAgIHZhciBhdHRlbXB0MyA9IC8uKkAoLispOihcXGQrKSQvLmV4ZWMoc3RhY2tMaW5lKTtcbiAgICBpZiAoYXR0ZW1wdDMpIHtcbiAgICAgICAgcmV0dXJuIFthdHRlbXB0M1sxXSwgTnVtYmVyKGF0dGVtcHQzWzJdKV07XG4gICAgfVxufVxuXG5mdW5jdGlvbiBpc0ludGVybmFsRnJhbWUoc3RhY2tMaW5lKSB7XG4gICAgdmFyIGZpbGVOYW1lQW5kTGluZU51bWJlciA9IGdldEZpbGVOYW1lQW5kTGluZU51bWJlcihzdGFja0xpbmUpO1xuXG4gICAgaWYgKCFmaWxlTmFtZUFuZExpbmVOdW1iZXIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHZhciBmaWxlTmFtZSA9IGZpbGVOYW1lQW5kTGluZU51bWJlclswXTtcbiAgICB2YXIgbGluZU51bWJlciA9IGZpbGVOYW1lQW5kTGluZU51bWJlclsxXTtcblxuICAgIHJldHVybiBmaWxlTmFtZSA9PT0gcUZpbGVOYW1lICYmXG4gICAgICAgIGxpbmVOdW1iZXIgPj0gcVN0YXJ0aW5nTGluZSAmJlxuICAgICAgICBsaW5lTnVtYmVyIDw9IHFFbmRpbmdMaW5lO1xufVxuXG4vLyBkaXNjb3ZlciBvd24gZmlsZSBuYW1lIGFuZCBsaW5lIG51bWJlciByYW5nZSBmb3IgZmlsdGVyaW5nIHN0YWNrXG4vLyB0cmFjZXNcbmZ1bmN0aW9uIGNhcHR1cmVMaW5lKCkge1xuICAgIGlmICghaGFzU3RhY2tzKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHZhciBsaW5lcyA9IGUuc3RhY2suc3BsaXQoXCJcXG5cIik7XG4gICAgICAgIHZhciBmaXJzdExpbmUgPSBsaW5lc1swXS5pbmRleE9mKFwiQFwiKSA+IDAgPyBsaW5lc1sxXSA6IGxpbmVzWzJdO1xuICAgICAgICB2YXIgZmlsZU5hbWVBbmRMaW5lTnVtYmVyID0gZ2V0RmlsZU5hbWVBbmRMaW5lTnVtYmVyKGZpcnN0TGluZSk7XG4gICAgICAgIGlmICghZmlsZU5hbWVBbmRMaW5lTnVtYmVyKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBxRmlsZU5hbWUgPSBmaWxlTmFtZUFuZExpbmVOdW1iZXJbMF07XG4gICAgICAgIHJldHVybiBmaWxlTmFtZUFuZExpbmVOdW1iZXJbMV07XG4gICAgfVxufVxuXG5mdW5jdGlvbiBkZXByZWNhdGUoY2FsbGJhY2ssIG5hbWUsIGFsdGVybmF0aXZlKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBjb25zb2xlICE9PSBcInVuZGVmaW5lZFwiICYmXG4gICAgICAgICAgICB0eXBlb2YgY29uc29sZS53YXJuID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybihuYW1lICsgXCIgaXMgZGVwcmVjYXRlZCwgdXNlIFwiICsgYWx0ZXJuYXRpdmUgK1xuICAgICAgICAgICAgICAgICAgICAgICAgIFwiIGluc3RlYWQuXCIsIG5ldyBFcnJvcihcIlwiKS5zdGFjayk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmFwcGx5KGNhbGxiYWNrLCBhcmd1bWVudHMpO1xuICAgIH07XG59XG5cbi8vIGVuZCBvZiBzaGltc1xuLy8gYmVnaW5uaW5nIG9mIHJlYWwgd29ya1xuXG4vKipcbiAqIENvbnN0cnVjdHMgYSBwcm9taXNlIGZvciBhbiBpbW1lZGlhdGUgcmVmZXJlbmNlLCBwYXNzZXMgcHJvbWlzZXMgdGhyb3VnaCwgb3JcbiAqIGNvZXJjZXMgcHJvbWlzZXMgZnJvbSBkaWZmZXJlbnQgc3lzdGVtcy5cbiAqIEBwYXJhbSB2YWx1ZSBpbW1lZGlhdGUgcmVmZXJlbmNlIG9yIHByb21pc2VcbiAqL1xuZnVuY3Rpb24gUSh2YWx1ZSkge1xuICAgIC8vIElmIHRoZSBvYmplY3QgaXMgYWxyZWFkeSBhIFByb21pc2UsIHJldHVybiBpdCBkaXJlY3RseS4gIFRoaXMgZW5hYmxlc1xuICAgIC8vIHRoZSByZXNvbHZlIGZ1bmN0aW9uIHRvIGJvdGggYmUgdXNlZCB0byBjcmVhdGVkIHJlZmVyZW5jZXMgZnJvbSBvYmplY3RzLFxuICAgIC8vIGJ1dCB0byB0b2xlcmFibHkgY29lcmNlIG5vbi1wcm9taXNlcyB0byBwcm9taXNlcy5cbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICAvLyBhc3NpbWlsYXRlIHRoZW5hYmxlc1xuICAgIGlmIChpc1Byb21pc2VBbGlrZSh2YWx1ZSkpIHtcbiAgICAgICAgcmV0dXJuIGNvZXJjZSh2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGZ1bGZpbGwodmFsdWUpO1xuICAgIH1cbn1cblEucmVzb2x2ZSA9IFE7XG5cbi8qKlxuICogUGVyZm9ybXMgYSB0YXNrIGluIGEgZnV0dXJlIHR1cm4gb2YgdGhlIGV2ZW50IGxvb3AuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSB0YXNrXG4gKi9cblEubmV4dFRpY2sgPSBuZXh0VGljaztcblxuLyoqXG4gKiBDb250cm9scyB3aGV0aGVyIG9yIG5vdCBsb25nIHN0YWNrIHRyYWNlcyB3aWxsIGJlIG9uXG4gKi9cblEubG9uZ1N0YWNrU3VwcG9ydCA9IGZhbHNlO1xuXG4vLyBlbmFibGUgbG9uZyBzdGFja3MgaWYgUV9ERUJVRyBpcyBzZXRcbmlmICh0eXBlb2YgcHJvY2VzcyA9PT0gXCJvYmplY3RcIiAmJiBwcm9jZXNzICYmIHByb2Nlc3MuZW52ICYmIHByb2Nlc3MuZW52LlFfREVCVUcpIHtcbiAgICBRLmxvbmdTdGFja1N1cHBvcnQgPSB0cnVlO1xufVxuXG4vKipcbiAqIENvbnN0cnVjdHMgYSB7cHJvbWlzZSwgcmVzb2x2ZSwgcmVqZWN0fSBvYmplY3QuXG4gKlxuICogYHJlc29sdmVgIGlzIGEgY2FsbGJhY2sgdG8gaW52b2tlIHdpdGggYSBtb3JlIHJlc29sdmVkIHZhbHVlIGZvciB0aGVcbiAqIHByb21pc2UuIFRvIGZ1bGZpbGwgdGhlIHByb21pc2UsIGludm9rZSBgcmVzb2x2ZWAgd2l0aCBhbnkgdmFsdWUgdGhhdCBpc1xuICogbm90IGEgdGhlbmFibGUuIFRvIHJlamVjdCB0aGUgcHJvbWlzZSwgaW52b2tlIGByZXNvbHZlYCB3aXRoIGEgcmVqZWN0ZWRcbiAqIHRoZW5hYmxlLCBvciBpbnZva2UgYHJlamVjdGAgd2l0aCB0aGUgcmVhc29uIGRpcmVjdGx5LiBUbyByZXNvbHZlIHRoZVxuICogcHJvbWlzZSB0byBhbm90aGVyIHRoZW5hYmxlLCB0aHVzIHB1dHRpbmcgaXQgaW4gdGhlIHNhbWUgc3RhdGUsIGludm9rZVxuICogYHJlc29sdmVgIHdpdGggdGhhdCBvdGhlciB0aGVuYWJsZS5cbiAqL1xuUS5kZWZlciA9IGRlZmVyO1xuZnVuY3Rpb24gZGVmZXIoKSB7XG4gICAgLy8gaWYgXCJtZXNzYWdlc1wiIGlzIGFuIFwiQXJyYXlcIiwgdGhhdCBpbmRpY2F0ZXMgdGhhdCB0aGUgcHJvbWlzZSBoYXMgbm90IHlldFxuICAgIC8vIGJlZW4gcmVzb2x2ZWQuICBJZiBpdCBpcyBcInVuZGVmaW5lZFwiLCBpdCBoYXMgYmVlbiByZXNvbHZlZC4gIEVhY2hcbiAgICAvLyBlbGVtZW50IG9mIHRoZSBtZXNzYWdlcyBhcnJheSBpcyBpdHNlbGYgYW4gYXJyYXkgb2YgY29tcGxldGUgYXJndW1lbnRzIHRvXG4gICAgLy8gZm9yd2FyZCB0byB0aGUgcmVzb2x2ZWQgcHJvbWlzZS4gIFdlIGNvZXJjZSB0aGUgcmVzb2x1dGlvbiB2YWx1ZSB0byBhXG4gICAgLy8gcHJvbWlzZSB1c2luZyB0aGUgYHJlc29sdmVgIGZ1bmN0aW9uIGJlY2F1c2UgaXQgaGFuZGxlcyBib3RoIGZ1bGx5XG4gICAgLy8gbm9uLXRoZW5hYmxlIHZhbHVlcyBhbmQgb3RoZXIgdGhlbmFibGVzIGdyYWNlZnVsbHkuXG4gICAgdmFyIG1lc3NhZ2VzID0gW10sIHByb2dyZXNzTGlzdGVuZXJzID0gW10sIHJlc29sdmVkUHJvbWlzZTtcblxuICAgIHZhciBkZWZlcnJlZCA9IG9iamVjdF9jcmVhdGUoZGVmZXIucHJvdG90eXBlKTtcbiAgICB2YXIgcHJvbWlzZSA9IG9iamVjdF9jcmVhdGUoUHJvbWlzZS5wcm90b3R5cGUpO1xuXG4gICAgcHJvbWlzZS5wcm9taXNlRGlzcGF0Y2ggPSBmdW5jdGlvbiAocmVzb2x2ZSwgb3AsIG9wZXJhbmRzKSB7XG4gICAgICAgIHZhciBhcmdzID0gYXJyYXlfc2xpY2UoYXJndW1lbnRzKTtcbiAgICAgICAgaWYgKG1lc3NhZ2VzKSB7XG4gICAgICAgICAgICBtZXNzYWdlcy5wdXNoKGFyZ3MpO1xuICAgICAgICAgICAgaWYgKG9wID09PSBcIndoZW5cIiAmJiBvcGVyYW5kc1sxXSkgeyAvLyBwcm9ncmVzcyBvcGVyYW5kXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3NMaXN0ZW5lcnMucHVzaChvcGVyYW5kc1sxXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBRLm5leHRUaWNrKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICByZXNvbHZlZFByb21pc2UucHJvbWlzZURpc3BhdGNoLmFwcGx5KHJlc29sdmVkUHJvbWlzZSwgYXJncyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBYWFggZGVwcmVjYXRlZFxuICAgIHByb21pc2UudmFsdWVPZiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKG1lc3NhZ2VzKSB7XG4gICAgICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbmVhcmVyVmFsdWUgPSBuZWFyZXIocmVzb2x2ZWRQcm9taXNlKTtcbiAgICAgICAgaWYgKGlzUHJvbWlzZShuZWFyZXJWYWx1ZSkpIHtcbiAgICAgICAgICAgIHJlc29sdmVkUHJvbWlzZSA9IG5lYXJlclZhbHVlOyAvLyBzaG9ydGVuIGNoYWluXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5lYXJlclZhbHVlO1xuICAgIH07XG5cbiAgICBwcm9taXNlLmluc3BlY3QgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICghcmVzb2x2ZWRQcm9taXNlKSB7XG4gICAgICAgICAgICByZXR1cm4geyBzdGF0ZTogXCJwZW5kaW5nXCIgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRQcm9taXNlLmluc3BlY3QoKTtcbiAgICB9O1xuXG4gICAgaWYgKFEubG9uZ1N0YWNrU3VwcG9ydCAmJiBoYXNTdGFja3MpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcigpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAvLyBOT1RFOiBkb24ndCB0cnkgdG8gdXNlIGBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZWAgb3IgdHJhbnNmZXIgdGhlXG4gICAgICAgICAgICAvLyBhY2Nlc3NvciBhcm91bmQ7IHRoYXQgY2F1c2VzIG1lbW9yeSBsZWFrcyBhcyBwZXIgR0gtMTExLiBKdXN0XG4gICAgICAgICAgICAvLyByZWlmeSB0aGUgc3RhY2sgdHJhY2UgYXMgYSBzdHJpbmcgQVNBUC5cbiAgICAgICAgICAgIC8vXG4gICAgICAgICAgICAvLyBBdCB0aGUgc2FtZSB0aW1lLCBjdXQgb2ZmIHRoZSBmaXJzdCBsaW5lOyBpdCdzIGFsd2F5cyBqdXN0XG4gICAgICAgICAgICAvLyBcIltvYmplY3QgUHJvbWlzZV1cXG5cIiwgYXMgcGVyIHRoZSBgdG9TdHJpbmdgLlxuICAgICAgICAgICAgcHJvbWlzZS5zdGFjayA9IGUuc3RhY2suc3Vic3RyaW5nKGUuc3RhY2suaW5kZXhPZihcIlxcblwiKSArIDEpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gTk9URTogd2UgZG8gdGhlIGNoZWNrcyBmb3IgYHJlc29sdmVkUHJvbWlzZWAgaW4gZWFjaCBtZXRob2QsIGluc3RlYWQgb2ZcbiAgICAvLyBjb25zb2xpZGF0aW5nIHRoZW0gaW50byBgYmVjb21lYCwgc2luY2Ugb3RoZXJ3aXNlIHdlJ2QgY3JlYXRlIG5ld1xuICAgIC8vIHByb21pc2VzIHdpdGggdGhlIGxpbmVzIGBiZWNvbWUod2hhdGV2ZXIodmFsdWUpKWAuIFNlZSBlLmcuIEdILTI1Mi5cblxuICAgIGZ1bmN0aW9uIGJlY29tZShuZXdQcm9taXNlKSB7XG4gICAgICAgIHJlc29sdmVkUHJvbWlzZSA9IG5ld1Byb21pc2U7XG4gICAgICAgIHByb21pc2Uuc291cmNlID0gbmV3UHJvbWlzZTtcblxuICAgICAgICBhcnJheV9yZWR1Y2UobWVzc2FnZXMsIGZ1bmN0aW9uICh1bmRlZmluZWQsIG1lc3NhZ2UpIHtcbiAgICAgICAgICAgIFEubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIG5ld1Byb21pc2UucHJvbWlzZURpc3BhdGNoLmFwcGx5KG5ld1Byb21pc2UsIG1lc3NhZ2UpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sIHZvaWQgMCk7XG5cbiAgICAgICAgbWVzc2FnZXMgPSB2b2lkIDA7XG4gICAgICAgIHByb2dyZXNzTGlzdGVuZXJzID0gdm9pZCAwO1xuICAgIH1cblxuICAgIGRlZmVycmVkLnByb21pc2UgPSBwcm9taXNlO1xuICAgIGRlZmVycmVkLnJlc29sdmUgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgaWYgKHJlc29sdmVkUHJvbWlzZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYmVjb21lKFEodmFsdWUpKTtcbiAgICB9O1xuXG4gICAgZGVmZXJyZWQuZnVsZmlsbCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICBpZiAocmVzb2x2ZWRQcm9taXNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBiZWNvbWUoZnVsZmlsbCh2YWx1ZSkpO1xuICAgIH07XG4gICAgZGVmZXJyZWQucmVqZWN0ID0gZnVuY3Rpb24gKHJlYXNvbikge1xuICAgICAgICBpZiAocmVzb2x2ZWRQcm9taXNlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBiZWNvbWUocmVqZWN0KHJlYXNvbikpO1xuICAgIH07XG4gICAgZGVmZXJyZWQubm90aWZ5ID0gZnVuY3Rpb24gKHByb2dyZXNzKSB7XG4gICAgICAgIGlmIChyZXNvbHZlZFByb21pc2UpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGFycmF5X3JlZHVjZShwcm9ncmVzc0xpc3RlbmVycywgZnVuY3Rpb24gKHVuZGVmaW5lZCwgcHJvZ3Jlc3NMaXN0ZW5lcikge1xuICAgICAgICAgICAgUS5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3NMaXN0ZW5lcihwcm9ncmVzcyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgdm9pZCAwKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIGRlZmVycmVkO1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBOb2RlLXN0eWxlIGNhbGxiYWNrIHRoYXQgd2lsbCByZXNvbHZlIG9yIHJlamVjdCB0aGUgZGVmZXJyZWRcbiAqIHByb21pc2UuXG4gKiBAcmV0dXJucyBhIG5vZGViYWNrXG4gKi9cbmRlZmVyLnByb3RvdHlwZS5tYWtlTm9kZVJlc29sdmVyID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICByZXR1cm4gZnVuY3Rpb24gKGVycm9yLCB2YWx1ZSkge1xuICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHNlbGYucmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSBlbHNlIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMikge1xuICAgICAgICAgICAgc2VsZi5yZXNvbHZlKGFycmF5X3NsaWNlKGFyZ3VtZW50cywgMSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc2VsZi5yZXNvbHZlKHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH07XG59O1xuXG4vKipcbiAqIEBwYXJhbSByZXNvbHZlciB7RnVuY3Rpb259IGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIG5vdGhpbmcgYW5kIGFjY2VwdHNcbiAqIHRoZSByZXNvbHZlLCByZWplY3QsIGFuZCBub3RpZnkgZnVuY3Rpb25zIGZvciBhIGRlZmVycmVkLlxuICogQHJldHVybnMgYSBwcm9taXNlIHRoYXQgbWF5IGJlIHJlc29sdmVkIHdpdGggdGhlIGdpdmVuIHJlc29sdmUgYW5kIHJlamVjdFxuICogZnVuY3Rpb25zLCBvciByZWplY3RlZCBieSBhIHRocm93biBleGNlcHRpb24gaW4gcmVzb2x2ZXJcbiAqL1xuUS5Qcm9taXNlID0gcHJvbWlzZTsgLy8gRVM2XG5RLnByb21pc2UgPSBwcm9taXNlO1xuZnVuY3Rpb24gcHJvbWlzZShyZXNvbHZlcikge1xuICAgIGlmICh0eXBlb2YgcmVzb2x2ZXIgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwicmVzb2x2ZXIgbXVzdCBiZSBhIGZ1bmN0aW9uLlwiKTtcbiAgICB9XG4gICAgdmFyIGRlZmVycmVkID0gZGVmZXIoKTtcbiAgICB0cnkge1xuICAgICAgICByZXNvbHZlcihkZWZlcnJlZC5yZXNvbHZlLCBkZWZlcnJlZC5yZWplY3QsIGRlZmVycmVkLm5vdGlmeSk7XG4gICAgfSBjYXRjaCAocmVhc29uKSB7XG4gICAgICAgIGRlZmVycmVkLnJlamVjdChyZWFzb24pO1xuICAgIH1cbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbn1cblxucHJvbWlzZS5yYWNlID0gcmFjZTsgLy8gRVM2XG5wcm9taXNlLmFsbCA9IGFsbDsgLy8gRVM2XG5wcm9taXNlLnJlamVjdCA9IHJlamVjdDsgLy8gRVM2XG5wcm9taXNlLnJlc29sdmUgPSBROyAvLyBFUzZcblxuLy8gWFhYIGV4cGVyaW1lbnRhbC4gIFRoaXMgbWV0aG9kIGlzIGEgd2F5IHRvIGRlbm90ZSB0aGF0IGEgbG9jYWwgdmFsdWUgaXNcbi8vIHNlcmlhbGl6YWJsZSBhbmQgc2hvdWxkIGJlIGltbWVkaWF0ZWx5IGRpc3BhdGNoZWQgdG8gYSByZW1vdGUgdXBvbiByZXF1ZXN0LFxuLy8gaW5zdGVhZCBvZiBwYXNzaW5nIGEgcmVmZXJlbmNlLlxuUS5wYXNzQnlDb3B5ID0gZnVuY3Rpb24gKG9iamVjdCkge1xuICAgIC8vZnJlZXplKG9iamVjdCk7XG4gICAgLy9wYXNzQnlDb3BpZXMuc2V0KG9iamVjdCwgdHJ1ZSk7XG4gICAgcmV0dXJuIG9iamVjdDtcbn07XG5cblByb21pc2UucHJvdG90eXBlLnBhc3NCeUNvcHkgPSBmdW5jdGlvbiAoKSB7XG4gICAgLy9mcmVlemUob2JqZWN0KTtcbiAgICAvL3Bhc3NCeUNvcGllcy5zZXQob2JqZWN0LCB0cnVlKTtcbiAgICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogSWYgdHdvIHByb21pc2VzIGV2ZW50dWFsbHkgZnVsZmlsbCB0byB0aGUgc2FtZSB2YWx1ZSwgcHJvbWlzZXMgdGhhdCB2YWx1ZSxcbiAqIGJ1dCBvdGhlcndpc2UgcmVqZWN0cy5cbiAqIEBwYXJhbSB4IHtBbnkqfVxuICogQHBhcmFtIHkge0FueSp9XG4gKiBAcmV0dXJucyB7QW55Kn0gYSBwcm9taXNlIGZvciB4IGFuZCB5IGlmIHRoZXkgYXJlIHRoZSBzYW1lLCBidXQgYSByZWplY3Rpb25cbiAqIG90aGVyd2lzZS5cbiAqXG4gKi9cblEuam9pbiA9IGZ1bmN0aW9uICh4LCB5KSB7XG4gICAgcmV0dXJuIFEoeCkuam9pbih5KTtcbn07XG5cblByb21pc2UucHJvdG90eXBlLmpvaW4gPSBmdW5jdGlvbiAodGhhdCkge1xuICAgIHJldHVybiBRKFt0aGlzLCB0aGF0XSkuc3ByZWFkKGZ1bmN0aW9uICh4LCB5KSB7XG4gICAgICAgIGlmICh4ID09PSB5KSB7XG4gICAgICAgICAgICAvLyBUT0RPOiBcIj09PVwiIHNob3VsZCBiZSBPYmplY3QuaXMgb3IgZXF1aXZcbiAgICAgICAgICAgIHJldHVybiB4O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3Qgam9pbjogbm90IHRoZSBzYW1lOiBcIiArIHggKyBcIiBcIiArIHkpO1xuICAgICAgICB9XG4gICAgfSk7XG59O1xuXG4vKipcbiAqIFJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgZmlyc3Qgb2YgYW4gYXJyYXkgb2YgcHJvbWlzZXMgdG8gYmVjb21lIHNldHRsZWQuXG4gKiBAcGFyYW0gYW5zd2VycyB7QXJyYXlbQW55Kl19IHByb21pc2VzIHRvIHJhY2VcbiAqIEByZXR1cm5zIHtBbnkqfSB0aGUgZmlyc3QgcHJvbWlzZSB0byBiZSBzZXR0bGVkXG4gKi9cblEucmFjZSA9IHJhY2U7XG5mdW5jdGlvbiByYWNlKGFuc3dlclBzKSB7XG4gICAgcmV0dXJuIHByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICAvLyBTd2l0Y2ggdG8gdGhpcyBvbmNlIHdlIGNhbiBhc3N1bWUgYXQgbGVhc3QgRVM1XG4gICAgICAgIC8vIGFuc3dlclBzLmZvckVhY2goZnVuY3Rpb24gKGFuc3dlclApIHtcbiAgICAgICAgLy8gICAgIFEoYW5zd2VyUCkudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAvLyB9KTtcbiAgICAgICAgLy8gVXNlIHRoaXMgaW4gdGhlIG1lYW50aW1lXG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhbnN3ZXJQcy5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgICAgICAgUShhbnN3ZXJQc1tpXSkudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cblByb21pc2UucHJvdG90eXBlLnJhY2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMudGhlbihRLnJhY2UpO1xufTtcblxuLyoqXG4gKiBDb25zdHJ1Y3RzIGEgUHJvbWlzZSB3aXRoIGEgcHJvbWlzZSBkZXNjcmlwdG9yIG9iamVjdCBhbmQgb3B0aW9uYWwgZmFsbGJhY2tcbiAqIGZ1bmN0aW9uLiAgVGhlIGRlc2NyaXB0b3IgY29udGFpbnMgbWV0aG9kcyBsaWtlIHdoZW4ocmVqZWN0ZWQpLCBnZXQobmFtZSksXG4gKiBzZXQobmFtZSwgdmFsdWUpLCBwb3N0KG5hbWUsIGFyZ3MpLCBhbmQgZGVsZXRlKG5hbWUpLCB3aGljaCBhbGxcbiAqIHJldHVybiBlaXRoZXIgYSB2YWx1ZSwgYSBwcm9taXNlIGZvciBhIHZhbHVlLCBvciBhIHJlamVjdGlvbi4gIFRoZSBmYWxsYmFja1xuICogYWNjZXB0cyB0aGUgb3BlcmF0aW9uIG5hbWUsIGEgcmVzb2x2ZXIsIGFuZCBhbnkgZnVydGhlciBhcmd1bWVudHMgdGhhdCB3b3VsZFxuICogaGF2ZSBiZWVuIGZvcndhcmRlZCB0byB0aGUgYXBwcm9wcmlhdGUgbWV0aG9kIGFib3ZlIGhhZCBhIG1ldGhvZCBiZWVuXG4gKiBwcm92aWRlZCB3aXRoIHRoZSBwcm9wZXIgbmFtZS4gIFRoZSBBUEkgbWFrZXMgbm8gZ3VhcmFudGVlcyBhYm91dCB0aGUgbmF0dXJlXG4gKiBvZiB0aGUgcmV0dXJuZWQgb2JqZWN0LCBhcGFydCBmcm9tIHRoYXQgaXQgaXMgdXNhYmxlIHdoZXJlZXZlciBwcm9taXNlcyBhcmVcbiAqIGJvdWdodCBhbmQgc29sZC5cbiAqL1xuUS5tYWtlUHJvbWlzZSA9IFByb21pc2U7XG5mdW5jdGlvbiBQcm9taXNlKGRlc2NyaXB0b3IsIGZhbGxiYWNrLCBpbnNwZWN0KSB7XG4gICAgaWYgKGZhbGxiYWNrID09PSB2b2lkIDApIHtcbiAgICAgICAgZmFsbGJhY2sgPSBmdW5jdGlvbiAob3ApIHtcbiAgICAgICAgICAgIHJldHVybiByZWplY3QobmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIFwiUHJvbWlzZSBkb2VzIG5vdCBzdXBwb3J0IG9wZXJhdGlvbjogXCIgKyBvcFxuICAgICAgICAgICAgKSk7XG4gICAgICAgIH07XG4gICAgfVxuICAgIGlmIChpbnNwZWN0ID09PSB2b2lkIDApIHtcbiAgICAgICAgaW5zcGVjdCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiB7c3RhdGU6IFwidW5rbm93blwifTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgcHJvbWlzZSA9IG9iamVjdF9jcmVhdGUoUHJvbWlzZS5wcm90b3R5cGUpO1xuXG4gICAgcHJvbWlzZS5wcm9taXNlRGlzcGF0Y2ggPSBmdW5jdGlvbiAocmVzb2x2ZSwgb3AsIGFyZ3MpIHtcbiAgICAgICAgdmFyIHJlc3VsdDtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGlmIChkZXNjcmlwdG9yW29wXSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdCA9IGRlc2NyaXB0b3Jbb3BdLmFwcGx5KHByb21pc2UsIGFyZ3MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBmYWxsYmFjay5jYWxsKHByb21pc2UsIG9wLCBhcmdzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXhjZXB0aW9uKSB7XG4gICAgICAgICAgICByZXN1bHQgPSByZWplY3QoZXhjZXB0aW9uKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocmVzb2x2ZSkge1xuICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHByb21pc2UuaW5zcGVjdCA9IGluc3BlY3Q7XG5cbiAgICAvLyBYWFggZGVwcmVjYXRlZCBgdmFsdWVPZmAgYW5kIGBleGNlcHRpb25gIHN1cHBvcnRcbiAgICBpZiAoaW5zcGVjdCkge1xuICAgICAgICB2YXIgaW5zcGVjdGVkID0gaW5zcGVjdCgpO1xuICAgICAgICBpZiAoaW5zcGVjdGVkLnN0YXRlID09PSBcInJlamVjdGVkXCIpIHtcbiAgICAgICAgICAgIHByb21pc2UuZXhjZXB0aW9uID0gaW5zcGVjdGVkLnJlYXNvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIHByb21pc2UudmFsdWVPZiA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBpbnNwZWN0ZWQgPSBpbnNwZWN0KCk7XG4gICAgICAgICAgICBpZiAoaW5zcGVjdGVkLnN0YXRlID09PSBcInBlbmRpbmdcIiB8fFxuICAgICAgICAgICAgICAgIGluc3BlY3RlZC5zdGF0ZSA9PT0gXCJyZWplY3RlZFwiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gaW5zcGVjdGVkLnZhbHVlO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiBwcm9taXNlO1xufVxuXG5Qcm9taXNlLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gXCJbb2JqZWN0IFByb21pc2VdXCI7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS50aGVuID0gZnVuY3Rpb24gKGZ1bGZpbGxlZCwgcmVqZWN0ZWQsIHByb2dyZXNzZWQpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIGRlZmVycmVkID0gZGVmZXIoKTtcbiAgICB2YXIgZG9uZSA9IGZhbHNlOyAgIC8vIGVuc3VyZSB0aGUgdW50cnVzdGVkIHByb21pc2UgbWFrZXMgYXQgbW9zdCBhXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzaW5nbGUgY2FsbCB0byBvbmUgb2YgdGhlIGNhbGxiYWNrc1xuXG4gICAgZnVuY3Rpb24gX2Z1bGZpbGxlZCh2YWx1ZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBmdWxmaWxsZWQgPT09IFwiZnVuY3Rpb25cIiA/IGZ1bGZpbGxlZCh2YWx1ZSkgOiB2YWx1ZTtcbiAgICAgICAgfSBjYXRjaCAoZXhjZXB0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVqZWN0KGV4Y2VwdGlvbik7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBfcmVqZWN0ZWQoZXhjZXB0aW9uKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcmVqZWN0ZWQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgbWFrZVN0YWNrVHJhY2VMb25nKGV4Y2VwdGlvbiwgc2VsZik7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJldHVybiByZWplY3RlZChleGNlcHRpb24pO1xuICAgICAgICAgICAgfSBjYXRjaCAobmV3RXhjZXB0aW9uKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdChuZXdFeGNlcHRpb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZWplY3QoZXhjZXB0aW9uKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBfcHJvZ3Jlc3NlZCh2YWx1ZSkge1xuICAgICAgICByZXR1cm4gdHlwZW9mIHByb2dyZXNzZWQgPT09IFwiZnVuY3Rpb25cIiA/IHByb2dyZXNzZWQodmFsdWUpIDogdmFsdWU7XG4gICAgfVxuXG4gICAgUS5uZXh0VGljayhmdW5jdGlvbiAoKSB7XG4gICAgICAgIHNlbGYucHJvbWlzZURpc3BhdGNoKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGRvbmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkb25lID0gdHJ1ZTtcblxuICAgICAgICAgICAgZGVmZXJyZWQucmVzb2x2ZShfZnVsZmlsbGVkKHZhbHVlKSk7XG4gICAgICAgIH0sIFwid2hlblwiLCBbZnVuY3Rpb24gKGV4Y2VwdGlvbikge1xuICAgICAgICAgICAgaWYgKGRvbmUpIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBkb25lID0gdHJ1ZTtcblxuICAgICAgICAgICAgZGVmZXJyZWQucmVzb2x2ZShfcmVqZWN0ZWQoZXhjZXB0aW9uKSk7XG4gICAgICAgIH1dKTtcbiAgICB9KTtcblxuICAgIC8vIFByb2dyZXNzIHByb3BhZ2F0b3IgbmVlZCB0byBiZSBhdHRhY2hlZCBpbiB0aGUgY3VycmVudCB0aWNrLlxuICAgIHNlbGYucHJvbWlzZURpc3BhdGNoKHZvaWQgMCwgXCJ3aGVuXCIsIFt2b2lkIDAsIGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICB2YXIgbmV3VmFsdWU7XG4gICAgICAgIHZhciB0aHJldyA9IGZhbHNlO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbmV3VmFsdWUgPSBfcHJvZ3Jlc3NlZCh2YWx1ZSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRocmV3ID0gdHJ1ZTtcbiAgICAgICAgICAgIGlmIChRLm9uZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBRLm9uZXJyb3IoZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRocmV3KSB7XG4gICAgICAgICAgICBkZWZlcnJlZC5ub3RpZnkobmV3VmFsdWUpO1xuICAgICAgICB9XG4gICAgfV0pO1xuXG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG59O1xuXG5RLnRhcCA9IGZ1bmN0aW9uIChwcm9taXNlLCBjYWxsYmFjaykge1xuICAgIHJldHVybiBRKHByb21pc2UpLnRhcChjYWxsYmFjayk7XG59O1xuXG4vKipcbiAqIFdvcmtzIGFsbW9zdCBsaWtlIFwiZmluYWxseVwiLCBidXQgbm90IGNhbGxlZCBmb3IgcmVqZWN0aW9ucy5cbiAqIE9yaWdpbmFsIHJlc29sdXRpb24gdmFsdWUgaXMgcGFzc2VkIHRocm91Z2ggY2FsbGJhY2sgdW5hZmZlY3RlZC5cbiAqIENhbGxiYWNrIG1heSByZXR1cm4gYSBwcm9taXNlIHRoYXQgd2lsbCBiZSBhd2FpdGVkIGZvci5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrXG4gKiBAcmV0dXJucyB7US5Qcm9taXNlfVxuICogQGV4YW1wbGVcbiAqIGRvU29tZXRoaW5nKClcbiAqICAgLnRoZW4oLi4uKVxuICogICAudGFwKGNvbnNvbGUubG9nKVxuICogICAudGhlbiguLi4pO1xuICovXG5Qcm9taXNlLnByb3RvdHlwZS50YXAgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICBjYWxsYmFjayA9IFEoY2FsbGJhY2spO1xuXG4gICAgcmV0dXJuIHRoaXMudGhlbihmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmZjYWxsKHZhbHVlKS50aGVuUmVzb2x2ZSh2YWx1ZSk7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqIFJlZ2lzdGVycyBhbiBvYnNlcnZlciBvbiBhIHByb21pc2UuXG4gKlxuICogR3VhcmFudGVlczpcbiAqXG4gKiAxLiB0aGF0IGZ1bGZpbGxlZCBhbmQgcmVqZWN0ZWQgd2lsbCBiZSBjYWxsZWQgb25seSBvbmNlLlxuICogMi4gdGhhdCBlaXRoZXIgdGhlIGZ1bGZpbGxlZCBjYWxsYmFjayBvciB0aGUgcmVqZWN0ZWQgY2FsbGJhY2sgd2lsbCBiZVxuICogICAgY2FsbGVkLCBidXQgbm90IGJvdGguXG4gKiAzLiB0aGF0IGZ1bGZpbGxlZCBhbmQgcmVqZWN0ZWQgd2lsbCBub3QgYmUgY2FsbGVkIGluIHRoaXMgdHVybi5cbiAqXG4gKiBAcGFyYW0gdmFsdWUgICAgICBwcm9taXNlIG9yIGltbWVkaWF0ZSByZWZlcmVuY2UgdG8gb2JzZXJ2ZVxuICogQHBhcmFtIGZ1bGZpbGxlZCAgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIHdpdGggdGhlIGZ1bGZpbGxlZCB2YWx1ZVxuICogQHBhcmFtIHJlamVjdGVkICAgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIHdpdGggdGhlIHJlamVjdGlvbiBleGNlcHRpb25cbiAqIEBwYXJhbSBwcm9ncmVzc2VkIGZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBvbiBhbnkgcHJvZ3Jlc3Mgbm90aWZpY2F0aW9uc1xuICogQHJldHVybiBwcm9taXNlIGZvciB0aGUgcmV0dXJuIHZhbHVlIGZyb20gdGhlIGludm9rZWQgY2FsbGJhY2tcbiAqL1xuUS53aGVuID0gd2hlbjtcbmZ1bmN0aW9uIHdoZW4odmFsdWUsIGZ1bGZpbGxlZCwgcmVqZWN0ZWQsIHByb2dyZXNzZWQpIHtcbiAgICByZXR1cm4gUSh2YWx1ZSkudGhlbihmdWxmaWxsZWQsIHJlamVjdGVkLCBwcm9ncmVzc2VkKTtcbn1cblxuUHJvbWlzZS5wcm90b3R5cGUudGhlblJlc29sdmUgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy50aGVuKGZ1bmN0aW9uICgpIHsgcmV0dXJuIHZhbHVlOyB9KTtcbn07XG5cblEudGhlblJlc29sdmUgPSBmdW5jdGlvbiAocHJvbWlzZSwgdmFsdWUpIHtcbiAgICByZXR1cm4gUShwcm9taXNlKS50aGVuUmVzb2x2ZSh2YWx1ZSk7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS50aGVuUmVqZWN0ID0gZnVuY3Rpb24gKHJlYXNvbikge1xuICAgIHJldHVybiB0aGlzLnRoZW4oZnVuY3Rpb24gKCkgeyB0aHJvdyByZWFzb247IH0pO1xufTtcblxuUS50aGVuUmVqZWN0ID0gZnVuY3Rpb24gKHByb21pc2UsIHJlYXNvbikge1xuICAgIHJldHVybiBRKHByb21pc2UpLnRoZW5SZWplY3QocmVhc29uKTtcbn07XG5cbi8qKlxuICogSWYgYW4gb2JqZWN0IGlzIG5vdCBhIHByb21pc2UsIGl0IGlzIGFzIFwibmVhclwiIGFzIHBvc3NpYmxlLlxuICogSWYgYSBwcm9taXNlIGlzIHJlamVjdGVkLCBpdCBpcyBhcyBcIm5lYXJcIiBhcyBwb3NzaWJsZSB0b28uXG4gKiBJZiBpdOKAmXMgYSBmdWxmaWxsZWQgcHJvbWlzZSwgdGhlIGZ1bGZpbGxtZW50IHZhbHVlIGlzIG5lYXJlci5cbiAqIElmIGl04oCZcyBhIGRlZmVycmVkIHByb21pc2UgYW5kIHRoZSBkZWZlcnJlZCBoYXMgYmVlbiByZXNvbHZlZCwgdGhlXG4gKiByZXNvbHV0aW9uIGlzIFwibmVhcmVyXCIuXG4gKiBAcGFyYW0gb2JqZWN0XG4gKiBAcmV0dXJucyBtb3N0IHJlc29sdmVkIChuZWFyZXN0KSBmb3JtIG9mIHRoZSBvYmplY3RcbiAqL1xuXG4vLyBYWFggc2hvdWxkIHdlIHJlLWRvIHRoaXM/XG5RLm5lYXJlciA9IG5lYXJlcjtcbmZ1bmN0aW9uIG5lYXJlcih2YWx1ZSkge1xuICAgIGlmIChpc1Byb21pc2UodmFsdWUpKSB7XG4gICAgICAgIHZhciBpbnNwZWN0ZWQgPSB2YWx1ZS5pbnNwZWN0KCk7XG4gICAgICAgIGlmIChpbnNwZWN0ZWQuc3RhdGUgPT09IFwiZnVsZmlsbGVkXCIpIHtcbiAgICAgICAgICAgIHJldHVybiBpbnNwZWN0ZWQudmFsdWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xufVxuXG4vKipcbiAqIEByZXR1cm5zIHdoZXRoZXIgdGhlIGdpdmVuIG9iamVjdCBpcyBhIHByb21pc2UuXG4gKiBPdGhlcndpc2UgaXQgaXMgYSBmdWxmaWxsZWQgdmFsdWUuXG4gKi9cblEuaXNQcm9taXNlID0gaXNQcm9taXNlO1xuZnVuY3Rpb24gaXNQcm9taXNlKG9iamVjdCkge1xuICAgIHJldHVybiBvYmplY3QgaW5zdGFuY2VvZiBQcm9taXNlO1xufVxuXG5RLmlzUHJvbWlzZUFsaWtlID0gaXNQcm9taXNlQWxpa2U7XG5mdW5jdGlvbiBpc1Byb21pc2VBbGlrZShvYmplY3QpIHtcbiAgICByZXR1cm4gaXNPYmplY3Qob2JqZWN0KSAmJiB0eXBlb2Ygb2JqZWN0LnRoZW4gPT09IFwiZnVuY3Rpb25cIjtcbn1cblxuLyoqXG4gKiBAcmV0dXJucyB3aGV0aGVyIHRoZSBnaXZlbiBvYmplY3QgaXMgYSBwZW5kaW5nIHByb21pc2UsIG1lYW5pbmcgbm90XG4gKiBmdWxmaWxsZWQgb3IgcmVqZWN0ZWQuXG4gKi9cblEuaXNQZW5kaW5nID0gaXNQZW5kaW5nO1xuZnVuY3Rpb24gaXNQZW5kaW5nKG9iamVjdCkge1xuICAgIHJldHVybiBpc1Byb21pc2Uob2JqZWN0KSAmJiBvYmplY3QuaW5zcGVjdCgpLnN0YXRlID09PSBcInBlbmRpbmdcIjtcbn1cblxuUHJvbWlzZS5wcm90b3R5cGUuaXNQZW5kaW5nID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB0aGlzLmluc3BlY3QoKS5zdGF0ZSA9PT0gXCJwZW5kaW5nXCI7XG59O1xuXG4vKipcbiAqIEByZXR1cm5zIHdoZXRoZXIgdGhlIGdpdmVuIG9iamVjdCBpcyBhIHZhbHVlIG9yIGZ1bGZpbGxlZFxuICogcHJvbWlzZS5cbiAqL1xuUS5pc0Z1bGZpbGxlZCA9IGlzRnVsZmlsbGVkO1xuZnVuY3Rpb24gaXNGdWxmaWxsZWQob2JqZWN0KSB7XG4gICAgcmV0dXJuICFpc1Byb21pc2Uob2JqZWN0KSB8fCBvYmplY3QuaW5zcGVjdCgpLnN0YXRlID09PSBcImZ1bGZpbGxlZFwiO1xufVxuXG5Qcm9taXNlLnByb3RvdHlwZS5pc0Z1bGZpbGxlZCA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5pbnNwZWN0KCkuc3RhdGUgPT09IFwiZnVsZmlsbGVkXCI7XG59O1xuXG4vKipcbiAqIEByZXR1cm5zIHdoZXRoZXIgdGhlIGdpdmVuIG9iamVjdCBpcyBhIHJlamVjdGVkIHByb21pc2UuXG4gKi9cblEuaXNSZWplY3RlZCA9IGlzUmVqZWN0ZWQ7XG5mdW5jdGlvbiBpc1JlamVjdGVkKG9iamVjdCkge1xuICAgIHJldHVybiBpc1Byb21pc2Uob2JqZWN0KSAmJiBvYmplY3QuaW5zcGVjdCgpLnN0YXRlID09PSBcInJlamVjdGVkXCI7XG59XG5cblByb21pc2UucHJvdG90eXBlLmlzUmVqZWN0ZWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5zcGVjdCgpLnN0YXRlID09PSBcInJlamVjdGVkXCI7XG59O1xuXG4vLy8vIEJFR0lOIFVOSEFORExFRCBSRUpFQ1RJT04gVFJBQ0tJTkdcblxuLy8gVGhpcyBwcm9taXNlIGxpYnJhcnkgY29uc3VtZXMgZXhjZXB0aW9ucyB0aHJvd24gaW4gaGFuZGxlcnMgc28gdGhleSBjYW4gYmVcbi8vIGhhbmRsZWQgYnkgYSBzdWJzZXF1ZW50IHByb21pc2UuICBUaGUgZXhjZXB0aW9ucyBnZXQgYWRkZWQgdG8gdGhpcyBhcnJheSB3aGVuXG4vLyB0aGV5IGFyZSBjcmVhdGVkLCBhbmQgcmVtb3ZlZCB3aGVuIHRoZXkgYXJlIGhhbmRsZWQuICBOb3RlIHRoYXQgaW4gRVM2IG9yXG4vLyBzaGltbWVkIGVudmlyb25tZW50cywgdGhpcyB3b3VsZCBuYXR1cmFsbHkgYmUgYSBgU2V0YC5cbnZhciB1bmhhbmRsZWRSZWFzb25zID0gW107XG52YXIgdW5oYW5kbGVkUmVqZWN0aW9ucyA9IFtdO1xudmFyIHJlcG9ydGVkVW5oYW5kbGVkUmVqZWN0aW9ucyA9IFtdO1xudmFyIHRyYWNrVW5oYW5kbGVkUmVqZWN0aW9ucyA9IHRydWU7XG5cbmZ1bmN0aW9uIHJlc2V0VW5oYW5kbGVkUmVqZWN0aW9ucygpIHtcbiAgICB1bmhhbmRsZWRSZWFzb25zLmxlbmd0aCA9IDA7XG4gICAgdW5oYW5kbGVkUmVqZWN0aW9ucy5sZW5ndGggPSAwO1xuXG4gICAgaWYgKCF0cmFja1VuaGFuZGxlZFJlamVjdGlvbnMpIHtcbiAgICAgICAgdHJhY2tVbmhhbmRsZWRSZWplY3Rpb25zID0gdHJ1ZTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIHRyYWNrUmVqZWN0aW9uKHByb21pc2UsIHJlYXNvbikge1xuICAgIGlmICghdHJhY2tVbmhhbmRsZWRSZWplY3Rpb25zKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBwcm9jZXNzID09PSBcIm9iamVjdFwiICYmIHR5cGVvZiBwcm9jZXNzLmVtaXQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBRLm5leHRUaWNrLnJ1bkFmdGVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGlmIChhcnJheV9pbmRleE9mKHVuaGFuZGxlZFJlamVjdGlvbnMsIHByb21pc2UpICE9PSAtMSkge1xuICAgICAgICAgICAgICAgIHByb2Nlc3MuZW1pdChcInVuaGFuZGxlZFJlamVjdGlvblwiLCByZWFzb24sIHByb21pc2UpO1xuICAgICAgICAgICAgICAgIHJlcG9ydGVkVW5oYW5kbGVkUmVqZWN0aW9ucy5wdXNoKHByb21pc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICB1bmhhbmRsZWRSZWplY3Rpb25zLnB1c2gocHJvbWlzZSk7XG4gICAgaWYgKHJlYXNvbiAmJiB0eXBlb2YgcmVhc29uLnN0YWNrICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHVuaGFuZGxlZFJlYXNvbnMucHVzaChyZWFzb24uc3RhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHVuaGFuZGxlZFJlYXNvbnMucHVzaChcIihubyBzdGFjaykgXCIgKyByZWFzb24pO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gdW50cmFja1JlamVjdGlvbihwcm9taXNlKSB7XG4gICAgaWYgKCF0cmFja1VuaGFuZGxlZFJlamVjdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBhdCA9IGFycmF5X2luZGV4T2YodW5oYW5kbGVkUmVqZWN0aW9ucywgcHJvbWlzZSk7XG4gICAgaWYgKGF0ICE9PSAtMSkge1xuICAgICAgICBpZiAodHlwZW9mIHByb2Nlc3MgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIHByb2Nlc3MuZW1pdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICBRLm5leHRUaWNrLnJ1bkFmdGVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgYXRSZXBvcnQgPSBhcnJheV9pbmRleE9mKHJlcG9ydGVkVW5oYW5kbGVkUmVqZWN0aW9ucywgcHJvbWlzZSk7XG4gICAgICAgICAgICAgICAgaWYgKGF0UmVwb3J0ICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzLmVtaXQoXCJyZWplY3Rpb25IYW5kbGVkXCIsIHVuaGFuZGxlZFJlYXNvbnNbYXRdLCBwcm9taXNlKTtcbiAgICAgICAgICAgICAgICAgICAgcmVwb3J0ZWRVbmhhbmRsZWRSZWplY3Rpb25zLnNwbGljZShhdFJlcG9ydCwgMSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgdW5oYW5kbGVkUmVqZWN0aW9ucy5zcGxpY2UoYXQsIDEpO1xuICAgICAgICB1bmhhbmRsZWRSZWFzb25zLnNwbGljZShhdCwgMSk7XG4gICAgfVxufVxuXG5RLnJlc2V0VW5oYW5kbGVkUmVqZWN0aW9ucyA9IHJlc2V0VW5oYW5kbGVkUmVqZWN0aW9ucztcblxuUS5nZXRVbmhhbmRsZWRSZWFzb25zID0gZnVuY3Rpb24gKCkge1xuICAgIC8vIE1ha2UgYSBjb3B5IHNvIHRoYXQgY29uc3VtZXJzIGNhbid0IGludGVyZmVyZSB3aXRoIG91ciBpbnRlcm5hbCBzdGF0ZS5cbiAgICByZXR1cm4gdW5oYW5kbGVkUmVhc29ucy5zbGljZSgpO1xufTtcblxuUS5zdG9wVW5oYW5kbGVkUmVqZWN0aW9uVHJhY2tpbmcgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmVzZXRVbmhhbmRsZWRSZWplY3Rpb25zKCk7XG4gICAgdHJhY2tVbmhhbmRsZWRSZWplY3Rpb25zID0gZmFsc2U7XG59O1xuXG5yZXNldFVuaGFuZGxlZFJlamVjdGlvbnMoKTtcblxuLy8vLyBFTkQgVU5IQU5ETEVEIFJFSkVDVElPTiBUUkFDS0lOR1xuXG4vKipcbiAqIENvbnN0cnVjdHMgYSByZWplY3RlZCBwcm9taXNlLlxuICogQHBhcmFtIHJlYXNvbiB2YWx1ZSBkZXNjcmliaW5nIHRoZSBmYWlsdXJlXG4gKi9cblEucmVqZWN0ID0gcmVqZWN0O1xuZnVuY3Rpb24gcmVqZWN0KHJlYXNvbikge1xuICAgIHZhciByZWplY3Rpb24gPSBQcm9taXNlKHtcbiAgICAgICAgXCJ3aGVuXCI6IGZ1bmN0aW9uIChyZWplY3RlZCkge1xuICAgICAgICAgICAgLy8gbm90ZSB0aGF0IHRoZSBlcnJvciBoYXMgYmVlbiBoYW5kbGVkXG4gICAgICAgICAgICBpZiAocmVqZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICB1bnRyYWNrUmVqZWN0aW9uKHRoaXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlamVjdGVkID8gcmVqZWN0ZWQocmVhc29uKSA6IHRoaXM7XG4gICAgICAgIH1cbiAgICB9LCBmdW5jdGlvbiBmYWxsYmFjaygpIHtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSwgZnVuY3Rpb24gaW5zcGVjdCgpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IFwicmVqZWN0ZWRcIiwgcmVhc29uOiByZWFzb24gfTtcbiAgICB9KTtcblxuICAgIC8vIE5vdGUgdGhhdCB0aGUgcmVhc29uIGhhcyBub3QgYmVlbiBoYW5kbGVkLlxuICAgIHRyYWNrUmVqZWN0aW9uKHJlamVjdGlvbiwgcmVhc29uKTtcblxuICAgIHJldHVybiByZWplY3Rpb247XG59XG5cbi8qKlxuICogQ29uc3RydWN0cyBhIGZ1bGZpbGxlZCBwcm9taXNlIGZvciBhbiBpbW1lZGlhdGUgcmVmZXJlbmNlLlxuICogQHBhcmFtIHZhbHVlIGltbWVkaWF0ZSByZWZlcmVuY2VcbiAqL1xuUS5mdWxmaWxsID0gZnVsZmlsbDtcbmZ1bmN0aW9uIGZ1bGZpbGwodmFsdWUpIHtcbiAgICByZXR1cm4gUHJvbWlzZSh7XG4gICAgICAgIFwid2hlblwiOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH0sXG4gICAgICAgIFwiZ2V0XCI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWVbbmFtZV07XG4gICAgICAgIH0sXG4gICAgICAgIFwic2V0XCI6IGZ1bmN0aW9uIChuYW1lLCByaHMpIHtcbiAgICAgICAgICAgIHZhbHVlW25hbWVdID0gcmhzO1xuICAgICAgICB9LFxuICAgICAgICBcImRlbGV0ZVwiOiBmdW5jdGlvbiAobmFtZSkge1xuICAgICAgICAgICAgZGVsZXRlIHZhbHVlW25hbWVdO1xuICAgICAgICB9LFxuICAgICAgICBcInBvc3RcIjogZnVuY3Rpb24gKG5hbWUsIGFyZ3MpIHtcbiAgICAgICAgICAgIC8vIE1hcmsgTWlsbGVyIHByb3Bvc2VzIHRoYXQgcG9zdCB3aXRoIG5vIG5hbWUgc2hvdWxkIGFwcGx5IGFcbiAgICAgICAgICAgIC8vIHByb21pc2VkIGZ1bmN0aW9uLlxuICAgICAgICAgICAgaWYgKG5hbWUgPT09IG51bGwgfHwgbmFtZSA9PT0gdm9pZCAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZhbHVlLmFwcGx5KHZvaWQgMCwgYXJncyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiB2YWx1ZVtuYW1lXS5hcHBseSh2YWx1ZSwgYXJncyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIFwiYXBwbHlcIjogZnVuY3Rpb24gKHRoaXNwLCBhcmdzKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWUuYXBwbHkodGhpc3AsIGFyZ3MpO1xuICAgICAgICB9LFxuICAgICAgICBcImtleXNcIjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIG9iamVjdF9rZXlzKHZhbHVlKTtcbiAgICAgICAgfVxuICAgIH0sIHZvaWQgMCwgZnVuY3Rpb24gaW5zcGVjdCgpIHtcbiAgICAgICAgcmV0dXJuIHsgc3RhdGU6IFwiZnVsZmlsbGVkXCIsIHZhbHVlOiB2YWx1ZSB9O1xuICAgIH0pO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIHRoZW5hYmxlcyB0byBRIHByb21pc2VzLlxuICogQHBhcmFtIHByb21pc2UgdGhlbmFibGUgcHJvbWlzZVxuICogQHJldHVybnMgYSBRIHByb21pc2VcbiAqL1xuZnVuY3Rpb24gY29lcmNlKHByb21pc2UpIHtcbiAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgIFEubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcHJvbWlzZS50aGVuKGRlZmVycmVkLnJlc29sdmUsIGRlZmVycmVkLnJlamVjdCwgZGVmZXJyZWQubm90aWZ5KTtcbiAgICAgICAgfSBjYXRjaCAoZXhjZXB0aW9uKSB7XG4gICAgICAgICAgICBkZWZlcnJlZC5yZWplY3QoZXhjZXB0aW9uKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xufVxuXG4vKipcbiAqIEFubm90YXRlcyBhbiBvYmplY3Qgc3VjaCB0aGF0IGl0IHdpbGwgbmV2ZXIgYmVcbiAqIHRyYW5zZmVycmVkIGF3YXkgZnJvbSB0aGlzIHByb2Nlc3Mgb3ZlciBhbnkgcHJvbWlzZVxuICogY29tbXVuaWNhdGlvbiBjaGFubmVsLlxuICogQHBhcmFtIG9iamVjdFxuICogQHJldHVybnMgcHJvbWlzZSBhIHdyYXBwaW5nIG9mIHRoYXQgb2JqZWN0IHRoYXRcbiAqIGFkZGl0aW9uYWxseSByZXNwb25kcyB0byB0aGUgXCJpc0RlZlwiIG1lc3NhZ2VcbiAqIHdpdGhvdXQgYSByZWplY3Rpb24uXG4gKi9cblEubWFzdGVyID0gbWFzdGVyO1xuZnVuY3Rpb24gbWFzdGVyKG9iamVjdCkge1xuICAgIHJldHVybiBQcm9taXNlKHtcbiAgICAgICAgXCJpc0RlZlwiOiBmdW5jdGlvbiAoKSB7fVxuICAgIH0sIGZ1bmN0aW9uIGZhbGxiYWNrKG9wLCBhcmdzKSB7XG4gICAgICAgIHJldHVybiBkaXNwYXRjaChvYmplY3QsIG9wLCBhcmdzKTtcbiAgICB9LCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBRKG9iamVjdCkuaW5zcGVjdCgpO1xuICAgIH0pO1xufVxuXG4vKipcbiAqIFNwcmVhZHMgdGhlIHZhbHVlcyBvZiBhIHByb21pc2VkIGFycmF5IG9mIGFyZ3VtZW50cyBpbnRvIHRoZVxuICogZnVsZmlsbG1lbnQgY2FsbGJhY2suXG4gKiBAcGFyYW0gZnVsZmlsbGVkIGNhbGxiYWNrIHRoYXQgcmVjZWl2ZXMgdmFyaWFkaWMgYXJndW1lbnRzIGZyb20gdGhlXG4gKiBwcm9taXNlZCBhcnJheVxuICogQHBhcmFtIHJlamVjdGVkIGNhbGxiYWNrIHRoYXQgcmVjZWl2ZXMgdGhlIGV4Y2VwdGlvbiBpZiB0aGUgcHJvbWlzZVxuICogaXMgcmVqZWN0ZWQuXG4gKiBAcmV0dXJucyBhIHByb21pc2UgZm9yIHRoZSByZXR1cm4gdmFsdWUgb3IgdGhyb3duIGV4Y2VwdGlvbiBvZlxuICogZWl0aGVyIGNhbGxiYWNrLlxuICovXG5RLnNwcmVhZCA9IHNwcmVhZDtcbmZ1bmN0aW9uIHNwcmVhZCh2YWx1ZSwgZnVsZmlsbGVkLCByZWplY3RlZCkge1xuICAgIHJldHVybiBRKHZhbHVlKS5zcHJlYWQoZnVsZmlsbGVkLCByZWplY3RlZCk7XG59XG5cblByb21pc2UucHJvdG90eXBlLnNwcmVhZCA9IGZ1bmN0aW9uIChmdWxmaWxsZWQsIHJlamVjdGVkKSB7XG4gICAgcmV0dXJuIHRoaXMuYWxsKCkudGhlbihmdW5jdGlvbiAoYXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIGZ1bGZpbGxlZC5hcHBseSh2b2lkIDAsIGFycmF5KTtcbiAgICB9LCByZWplY3RlZCk7XG59O1xuXG4vKipcbiAqIFRoZSBhc3luYyBmdW5jdGlvbiBpcyBhIGRlY29yYXRvciBmb3IgZ2VuZXJhdG9yIGZ1bmN0aW9ucywgdHVybmluZ1xuICogdGhlbSBpbnRvIGFzeW5jaHJvbm91cyBnZW5lcmF0b3JzLiAgQWx0aG91Z2ggZ2VuZXJhdG9ycyBhcmUgb25seSBwYXJ0XG4gKiBvZiB0aGUgbmV3ZXN0IEVDTUFTY3JpcHQgNiBkcmFmdHMsIHRoaXMgY29kZSBkb2VzIG5vdCBjYXVzZSBzeW50YXhcbiAqIGVycm9ycyBpbiBvbGRlciBlbmdpbmVzLiAgVGhpcyBjb2RlIHNob3VsZCBjb250aW51ZSB0byB3b3JrIGFuZCB3aWxsXG4gKiBpbiBmYWN0IGltcHJvdmUgb3ZlciB0aW1lIGFzIHRoZSBsYW5ndWFnZSBpbXByb3Zlcy5cbiAqXG4gKiBFUzYgZ2VuZXJhdG9ycyBhcmUgY3VycmVudGx5IHBhcnQgb2YgVjggdmVyc2lvbiAzLjE5IHdpdGggdGhlXG4gKiAtLWhhcm1vbnktZ2VuZXJhdG9ycyBydW50aW1lIGZsYWcgZW5hYmxlZC4gIFNwaWRlck1vbmtleSBoYXMgaGFkIHRoZW1cbiAqIGZvciBsb25nZXIsIGJ1dCB1bmRlciBhbiBvbGRlciBQeXRob24taW5zcGlyZWQgZm9ybS4gIFRoaXMgZnVuY3Rpb25cbiAqIHdvcmtzIG9uIGJvdGgga2luZHMgb2YgZ2VuZXJhdG9ycy5cbiAqXG4gKiBEZWNvcmF0ZXMgYSBnZW5lcmF0b3IgZnVuY3Rpb24gc3VjaCB0aGF0OlxuICogIC0gaXQgbWF5IHlpZWxkIHByb21pc2VzXG4gKiAgLSBleGVjdXRpb24gd2lsbCBjb250aW51ZSB3aGVuIHRoYXQgcHJvbWlzZSBpcyBmdWxmaWxsZWRcbiAqICAtIHRoZSB2YWx1ZSBvZiB0aGUgeWllbGQgZXhwcmVzc2lvbiB3aWxsIGJlIHRoZSBmdWxmaWxsZWQgdmFsdWVcbiAqICAtIGl0IHJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgcmV0dXJuIHZhbHVlICh3aGVuIHRoZSBnZW5lcmF0b3JcbiAqICAgIHN0b3BzIGl0ZXJhdGluZylcbiAqICAtIHRoZSBkZWNvcmF0ZWQgZnVuY3Rpb24gcmV0dXJucyBhIHByb21pc2UgZm9yIHRoZSByZXR1cm4gdmFsdWVcbiAqICAgIG9mIHRoZSBnZW5lcmF0b3Igb3IgdGhlIGZpcnN0IHJlamVjdGVkIHByb21pc2UgYW1vbmcgdGhvc2VcbiAqICAgIHlpZWxkZWQuXG4gKiAgLSBpZiBhbiBlcnJvciBpcyB0aHJvd24gaW4gdGhlIGdlbmVyYXRvciwgaXQgcHJvcGFnYXRlcyB0aHJvdWdoXG4gKiAgICBldmVyeSBmb2xsb3dpbmcgeWllbGQgdW50aWwgaXQgaXMgY2F1Z2h0LCBvciB1bnRpbCBpdCBlc2NhcGVzXG4gKiAgICB0aGUgZ2VuZXJhdG9yIGZ1bmN0aW9uIGFsdG9nZXRoZXIsIGFuZCBpcyB0cmFuc2xhdGVkIGludG8gYVxuICogICAgcmVqZWN0aW9uIGZvciB0aGUgcHJvbWlzZSByZXR1cm5lZCBieSB0aGUgZGVjb3JhdGVkIGdlbmVyYXRvci5cbiAqL1xuUS5hc3luYyA9IGFzeW5jO1xuZnVuY3Rpb24gYXN5bmMobWFrZUdlbmVyYXRvcikge1xuICAgIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHdoZW4gdmVyYiBpcyBcInNlbmRcIiwgYXJnIGlzIGEgdmFsdWVcbiAgICAgICAgLy8gd2hlbiB2ZXJiIGlzIFwidGhyb3dcIiwgYXJnIGlzIGFuIGV4Y2VwdGlvblxuICAgICAgICBmdW5jdGlvbiBjb250aW51ZXIodmVyYiwgYXJnKSB7XG4gICAgICAgICAgICB2YXIgcmVzdWx0O1xuXG4gICAgICAgICAgICAvLyBVbnRpbCBWOCAzLjE5IC8gQ2hyb21pdW0gMjkgaXMgcmVsZWFzZWQsIFNwaWRlck1vbmtleSBpcyB0aGUgb25seVxuICAgICAgICAgICAgLy8gZW5naW5lIHRoYXQgaGFzIGEgZGVwbG95ZWQgYmFzZSBvZiBicm93c2VycyB0aGF0IHN1cHBvcnQgZ2VuZXJhdG9ycy5cbiAgICAgICAgICAgIC8vIEhvd2V2ZXIsIFNNJ3MgZ2VuZXJhdG9ycyB1c2UgdGhlIFB5dGhvbi1pbnNwaXJlZCBzZW1hbnRpY3Mgb2ZcbiAgICAgICAgICAgIC8vIG91dGRhdGVkIEVTNiBkcmFmdHMuICBXZSB3b3VsZCBsaWtlIHRvIHN1cHBvcnQgRVM2LCBidXQgd2UnZCBhbHNvXG4gICAgICAgICAgICAvLyBsaWtlIHRvIG1ha2UgaXQgcG9zc2libGUgdG8gdXNlIGdlbmVyYXRvcnMgaW4gZGVwbG95ZWQgYnJvd3NlcnMsIHNvXG4gICAgICAgICAgICAvLyB3ZSBhbHNvIHN1cHBvcnQgUHl0aG9uLXN0eWxlIGdlbmVyYXRvcnMuICBBdCBzb21lIHBvaW50IHdlIGNhbiByZW1vdmVcbiAgICAgICAgICAgIC8vIHRoaXMgYmxvY2suXG5cbiAgICAgICAgICAgIGlmICh0eXBlb2YgU3RvcEl0ZXJhdGlvbiA9PT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgICAgIC8vIEVTNiBHZW5lcmF0b3JzXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0ID0gZ2VuZXJhdG9yW3ZlcmJdKGFyZyk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXhjZXB0aW9uKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiByZWplY3QoZXhjZXB0aW9uKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKHJlc3VsdC5kb25lKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBRKHJlc3VsdC52YWx1ZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHdoZW4ocmVzdWx0LnZhbHVlLCBjYWxsYmFjaywgZXJyYmFjayk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBTcGlkZXJNb25rZXkgR2VuZXJhdG9yc1xuICAgICAgICAgICAgICAgIC8vIEZJWE1FOiBSZW1vdmUgdGhpcyBjYXNlIHdoZW4gU00gZG9lcyBFUzYgZ2VuZXJhdG9ycy5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXN1bHQgPSBnZW5lcmF0b3JbdmVyYl0oYXJnKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChleGNlcHRpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlzU3RvcEl0ZXJhdGlvbihleGNlcHRpb24pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gUShleGNlcHRpb24udmFsdWUpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdChleGNlcHRpb24pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiB3aGVuKHJlc3VsdCwgY2FsbGJhY2ssIGVycmJhY2spO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciBnZW5lcmF0b3IgPSBtYWtlR2VuZXJhdG9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIHZhciBjYWxsYmFjayA9IGNvbnRpbnVlci5iaW5kKGNvbnRpbnVlciwgXCJuZXh0XCIpO1xuICAgICAgICB2YXIgZXJyYmFjayA9IGNvbnRpbnVlci5iaW5kKGNvbnRpbnVlciwgXCJ0aHJvd1wiKTtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgfTtcbn1cblxuLyoqXG4gKiBUaGUgc3Bhd24gZnVuY3Rpb24gaXMgYSBzbWFsbCB3cmFwcGVyIGFyb3VuZCBhc3luYyB0aGF0IGltbWVkaWF0ZWx5XG4gKiBjYWxscyB0aGUgZ2VuZXJhdG9yIGFuZCBhbHNvIGVuZHMgdGhlIHByb21pc2UgY2hhaW4sIHNvIHRoYXQgYW55XG4gKiB1bmhhbmRsZWQgZXJyb3JzIGFyZSB0aHJvd24gaW5zdGVhZCBvZiBmb3J3YXJkZWQgdG8gdGhlIGVycm9yXG4gKiBoYW5kbGVyLiBUaGlzIGlzIHVzZWZ1bCBiZWNhdXNlIGl0J3MgZXh0cmVtZWx5IGNvbW1vbiB0byBydW5cbiAqIGdlbmVyYXRvcnMgYXQgdGhlIHRvcC1sZXZlbCB0byB3b3JrIHdpdGggbGlicmFyaWVzLlxuICovXG5RLnNwYXduID0gc3Bhd247XG5mdW5jdGlvbiBzcGF3bihtYWtlR2VuZXJhdG9yKSB7XG4gICAgUS5kb25lKFEuYXN5bmMobWFrZUdlbmVyYXRvcikoKSk7XG59XG5cbi8vIEZJWE1FOiBSZW1vdmUgdGhpcyBpbnRlcmZhY2Ugb25jZSBFUzYgZ2VuZXJhdG9ycyBhcmUgaW4gU3BpZGVyTW9ua2V5LlxuLyoqXG4gKiBUaHJvd3MgYSBSZXR1cm5WYWx1ZSBleGNlcHRpb24gdG8gc3RvcCBhbiBhc3luY2hyb25vdXMgZ2VuZXJhdG9yLlxuICpcbiAqIFRoaXMgaW50ZXJmYWNlIGlzIGEgc3RvcC1nYXAgbWVhc3VyZSB0byBzdXBwb3J0IGdlbmVyYXRvciByZXR1cm5cbiAqIHZhbHVlcyBpbiBvbGRlciBGaXJlZm94L1NwaWRlck1vbmtleS4gIEluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBFUzZcbiAqIGdlbmVyYXRvcnMgbGlrZSBDaHJvbWl1bSAyOSwganVzdCB1c2UgXCJyZXR1cm5cIiBpbiB5b3VyIGdlbmVyYXRvclxuICogZnVuY3Rpb25zLlxuICpcbiAqIEBwYXJhbSB2YWx1ZSB0aGUgcmV0dXJuIHZhbHVlIGZvciB0aGUgc3Vycm91bmRpbmcgZ2VuZXJhdG9yXG4gKiBAdGhyb3dzIFJldHVyblZhbHVlIGV4Y2VwdGlvbiB3aXRoIHRoZSB2YWx1ZS5cbiAqIEBleGFtcGxlXG4gKiAvLyBFUzYgc3R5bGVcbiAqIFEuYXN5bmMoZnVuY3Rpb24qICgpIHtcbiAqICAgICAgdmFyIGZvbyA9IHlpZWxkIGdldEZvb1Byb21pc2UoKTtcbiAqICAgICAgdmFyIGJhciA9IHlpZWxkIGdldEJhclByb21pc2UoKTtcbiAqICAgICAgcmV0dXJuIGZvbyArIGJhcjtcbiAqIH0pXG4gKiAvLyBPbGRlciBTcGlkZXJNb25rZXkgc3R5bGVcbiAqIFEuYXN5bmMoZnVuY3Rpb24gKCkge1xuICogICAgICB2YXIgZm9vID0geWllbGQgZ2V0Rm9vUHJvbWlzZSgpO1xuICogICAgICB2YXIgYmFyID0geWllbGQgZ2V0QmFyUHJvbWlzZSgpO1xuICogICAgICBRLnJldHVybihmb28gKyBiYXIpO1xuICogfSlcbiAqL1xuUVtcInJldHVyblwiXSA9IF9yZXR1cm47XG5mdW5jdGlvbiBfcmV0dXJuKHZhbHVlKSB7XG4gICAgdGhyb3cgbmV3IFFSZXR1cm5WYWx1ZSh2YWx1ZSk7XG59XG5cbi8qKlxuICogVGhlIHByb21pc2VkIGZ1bmN0aW9uIGRlY29yYXRvciBlbnN1cmVzIHRoYXQgYW55IHByb21pc2UgYXJndW1lbnRzXG4gKiBhcmUgc2V0dGxlZCBhbmQgcGFzc2VkIGFzIHZhbHVlcyAoYHRoaXNgIGlzIGFsc28gc2V0dGxlZCBhbmQgcGFzc2VkXG4gKiBhcyBhIHZhbHVlKS4gIEl0IHdpbGwgYWxzbyBlbnN1cmUgdGhhdCB0aGUgcmVzdWx0IG9mIGEgZnVuY3Rpb24gaXNcbiAqIGFsd2F5cyBhIHByb21pc2UuXG4gKlxuICogQGV4YW1wbGVcbiAqIHZhciBhZGQgPSBRLnByb21pc2VkKGZ1bmN0aW9uIChhLCBiKSB7XG4gKiAgICAgcmV0dXJuIGEgKyBiO1xuICogfSk7XG4gKiBhZGQoUShhKSwgUShCKSk7XG4gKlxuICogQHBhcmFtIHtmdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGRlY29yYXRlXG4gKiBAcmV0dXJucyB7ZnVuY3Rpb259IGEgZnVuY3Rpb24gdGhhdCBoYXMgYmVlbiBkZWNvcmF0ZWQuXG4gKi9cblEucHJvbWlzZWQgPSBwcm9taXNlZDtcbmZ1bmN0aW9uIHByb21pc2VkKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHNwcmVhZChbdGhpcywgYWxsKGFyZ3VtZW50cyldLCBmdW5jdGlvbiAoc2VsZiwgYXJncykge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmFwcGx5KHNlbGYsIGFyZ3MpO1xuICAgICAgICB9KTtcbiAgICB9O1xufVxuXG4vKipcbiAqIHNlbmRzIGEgbWVzc2FnZSB0byBhIHZhbHVlIGluIGEgZnV0dXJlIHR1cm5cbiAqIEBwYXJhbSBvYmplY3QqIHRoZSByZWNpcGllbnRcbiAqIEBwYXJhbSBvcCB0aGUgbmFtZSBvZiB0aGUgbWVzc2FnZSBvcGVyYXRpb24sIGUuZy4sIFwid2hlblwiLFxuICogQHBhcmFtIGFyZ3MgZnVydGhlciBhcmd1bWVudHMgdG8gYmUgZm9yd2FyZGVkIHRvIHRoZSBvcGVyYXRpb25cbiAqIEByZXR1cm5zIHJlc3VsdCB7UHJvbWlzZX0gYSBwcm9taXNlIGZvciB0aGUgcmVzdWx0IG9mIHRoZSBvcGVyYXRpb25cbiAqL1xuUS5kaXNwYXRjaCA9IGRpc3BhdGNoO1xuZnVuY3Rpb24gZGlzcGF0Y2gob2JqZWN0LCBvcCwgYXJncykge1xuICAgIHJldHVybiBRKG9iamVjdCkuZGlzcGF0Y2gob3AsIGFyZ3MpO1xufVxuXG5Qcm9taXNlLnByb3RvdHlwZS5kaXNwYXRjaCA9IGZ1bmN0aW9uIChvcCwgYXJncykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgIFEubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICBzZWxmLnByb21pc2VEaXNwYXRjaChkZWZlcnJlZC5yZXNvbHZlLCBvcCwgYXJncyk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG59O1xuXG4vKipcbiAqIEdldHMgdGhlIHZhbHVlIG9mIGEgcHJvcGVydHkgaW4gYSBmdXR1cmUgdHVybi5cbiAqIEBwYXJhbSBvYmplY3QgICAgcHJvbWlzZSBvciBpbW1lZGlhdGUgcmVmZXJlbmNlIGZvciB0YXJnZXQgb2JqZWN0XG4gKiBAcGFyYW0gbmFtZSAgICAgIG5hbWUgb2YgcHJvcGVydHkgdG8gZ2V0XG4gKiBAcmV0dXJuIHByb21pc2UgZm9yIHRoZSBwcm9wZXJ0eSB2YWx1ZVxuICovXG5RLmdldCA9IGZ1bmN0aW9uIChvYmplY3QsIGtleSkge1xuICAgIHJldHVybiBRKG9iamVjdCkuZGlzcGF0Y2goXCJnZXRcIiwgW2tleV0pO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gKGtleSkge1xuICAgIHJldHVybiB0aGlzLmRpc3BhdGNoKFwiZ2V0XCIsIFtrZXldKTtcbn07XG5cbi8qKlxuICogU2V0cyB0aGUgdmFsdWUgb2YgYSBwcm9wZXJ0eSBpbiBhIGZ1dHVyZSB0dXJuLlxuICogQHBhcmFtIG9iamVjdCAgICBwcm9taXNlIG9yIGltbWVkaWF0ZSByZWZlcmVuY2UgZm9yIG9iamVjdCBvYmplY3RcbiAqIEBwYXJhbSBuYW1lICAgICAgbmFtZSBvZiBwcm9wZXJ0eSB0byBzZXRcbiAqIEBwYXJhbSB2YWx1ZSAgICAgbmV3IHZhbHVlIG9mIHByb3BlcnR5XG4gKiBAcmV0dXJuIHByb21pc2UgZm9yIHRoZSByZXR1cm4gdmFsdWVcbiAqL1xuUS5zZXQgPSBmdW5jdGlvbiAob2JqZWN0LCBrZXksIHZhbHVlKSB7XG4gICAgcmV0dXJuIFEob2JqZWN0KS5kaXNwYXRjaChcInNldFwiLCBba2V5LCB2YWx1ZV0pO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5kaXNwYXRjaChcInNldFwiLCBba2V5LCB2YWx1ZV0pO1xufTtcblxuLyoqXG4gKiBEZWxldGVzIGEgcHJvcGVydHkgaW4gYSBmdXR1cmUgdHVybi5cbiAqIEBwYXJhbSBvYmplY3QgICAgcHJvbWlzZSBvciBpbW1lZGlhdGUgcmVmZXJlbmNlIGZvciB0YXJnZXQgb2JqZWN0XG4gKiBAcGFyYW0gbmFtZSAgICAgIG5hbWUgb2YgcHJvcGVydHkgdG8gZGVsZXRlXG4gKiBAcmV0dXJuIHByb21pc2UgZm9yIHRoZSByZXR1cm4gdmFsdWVcbiAqL1xuUS5kZWwgPSAvLyBYWFggbGVnYWN5XG5RW1wiZGVsZXRlXCJdID0gZnVuY3Rpb24gKG9iamVjdCwga2V5KSB7XG4gICAgcmV0dXJuIFEob2JqZWN0KS5kaXNwYXRjaChcImRlbGV0ZVwiLCBba2V5XSk7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS5kZWwgPSAvLyBYWFggbGVnYWN5XG5Qcm9taXNlLnByb3RvdHlwZVtcImRlbGV0ZVwiXSA9IGZ1bmN0aW9uIChrZXkpIHtcbiAgICByZXR1cm4gdGhpcy5kaXNwYXRjaChcImRlbGV0ZVwiLCBba2V5XSk7XG59O1xuXG4vKipcbiAqIEludm9rZXMgYSBtZXRob2QgaW4gYSBmdXR1cmUgdHVybi5cbiAqIEBwYXJhbSBvYmplY3QgICAgcHJvbWlzZSBvciBpbW1lZGlhdGUgcmVmZXJlbmNlIGZvciB0YXJnZXQgb2JqZWN0XG4gKiBAcGFyYW0gbmFtZSAgICAgIG5hbWUgb2YgbWV0aG9kIHRvIGludm9rZVxuICogQHBhcmFtIHZhbHVlICAgICBhIHZhbHVlIHRvIHBvc3QsIHR5cGljYWxseSBhbiBhcnJheSBvZlxuICogICAgICAgICAgICAgICAgICBpbnZvY2F0aW9uIGFyZ3VtZW50cyBmb3IgcHJvbWlzZXMgdGhhdFxuICogICAgICAgICAgICAgICAgICBhcmUgdWx0aW1hdGVseSBiYWNrZWQgd2l0aCBgcmVzb2x2ZWAgdmFsdWVzLFxuICogICAgICAgICAgICAgICAgICBhcyBvcHBvc2VkIHRvIHRob3NlIGJhY2tlZCB3aXRoIFVSTHNcbiAqICAgICAgICAgICAgICAgICAgd2hlcmVpbiB0aGUgcG9zdGVkIHZhbHVlIGNhbiBiZSBhbnlcbiAqICAgICAgICAgICAgICAgICAgSlNPTiBzZXJpYWxpemFibGUgb2JqZWN0LlxuICogQHJldHVybiBwcm9taXNlIGZvciB0aGUgcmV0dXJuIHZhbHVlXG4gKi9cbi8vIGJvdW5kIGxvY2FsbHkgYmVjYXVzZSBpdCBpcyB1c2VkIGJ5IG90aGVyIG1ldGhvZHNcblEubWFwcGx5ID0gLy8gWFhYIEFzIHByb3Bvc2VkIGJ5IFwiUmVkc2FuZHJvXCJcblEucG9zdCA9IGZ1bmN0aW9uIChvYmplY3QsIG5hbWUsIGFyZ3MpIHtcbiAgICByZXR1cm4gUShvYmplY3QpLmRpc3BhdGNoKFwicG9zdFwiLCBbbmFtZSwgYXJnc10pO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUubWFwcGx5ID0gLy8gWFhYIEFzIHByb3Bvc2VkIGJ5IFwiUmVkc2FuZHJvXCJcblByb21pc2UucHJvdG90eXBlLnBvc3QgPSBmdW5jdGlvbiAobmFtZSwgYXJncykge1xuICAgIHJldHVybiB0aGlzLmRpc3BhdGNoKFwicG9zdFwiLCBbbmFtZSwgYXJnc10pO1xufTtcblxuLyoqXG4gKiBJbnZva2VzIGEgbWV0aG9kIGluIGEgZnV0dXJlIHR1cm4uXG4gKiBAcGFyYW0gb2JqZWN0ICAgIHByb21pc2Ugb3IgaW1tZWRpYXRlIHJlZmVyZW5jZSBmb3IgdGFyZ2V0IG9iamVjdFxuICogQHBhcmFtIG5hbWUgICAgICBuYW1lIG9mIG1ldGhvZCB0byBpbnZva2VcbiAqIEBwYXJhbSAuLi5hcmdzICAgYXJyYXkgb2YgaW52b2NhdGlvbiBhcmd1bWVudHNcbiAqIEByZXR1cm4gcHJvbWlzZSBmb3IgdGhlIHJldHVybiB2YWx1ZVxuICovXG5RLnNlbmQgPSAvLyBYWFggTWFyayBNaWxsZXIncyBwcm9wb3NlZCBwYXJsYW5jZVxuUS5tY2FsbCA9IC8vIFhYWCBBcyBwcm9wb3NlZCBieSBcIlJlZHNhbmRyb1wiXG5RLmludm9rZSA9IGZ1bmN0aW9uIChvYmplY3QsIG5hbWUgLyouLi5hcmdzKi8pIHtcbiAgICByZXR1cm4gUShvYmplY3QpLmRpc3BhdGNoKFwicG9zdFwiLCBbbmFtZSwgYXJyYXlfc2xpY2UoYXJndW1lbnRzLCAyKV0pO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUuc2VuZCA9IC8vIFhYWCBNYXJrIE1pbGxlcidzIHByb3Bvc2VkIHBhcmxhbmNlXG5Qcm9taXNlLnByb3RvdHlwZS5tY2FsbCA9IC8vIFhYWCBBcyBwcm9wb3NlZCBieSBcIlJlZHNhbmRyb1wiXG5Qcm9taXNlLnByb3RvdHlwZS5pbnZva2UgPSBmdW5jdGlvbiAobmFtZSAvKi4uLmFyZ3MqLykge1xuICAgIHJldHVybiB0aGlzLmRpc3BhdGNoKFwicG9zdFwiLCBbbmFtZSwgYXJyYXlfc2xpY2UoYXJndW1lbnRzLCAxKV0pO1xufTtcblxuLyoqXG4gKiBBcHBsaWVzIHRoZSBwcm9taXNlZCBmdW5jdGlvbiBpbiBhIGZ1dHVyZSB0dXJuLlxuICogQHBhcmFtIG9iamVjdCAgICBwcm9taXNlIG9yIGltbWVkaWF0ZSByZWZlcmVuY2UgZm9yIHRhcmdldCBmdW5jdGlvblxuICogQHBhcmFtIGFyZ3MgICAgICBhcnJheSBvZiBhcHBsaWNhdGlvbiBhcmd1bWVudHNcbiAqL1xuUS5mYXBwbHkgPSBmdW5jdGlvbiAob2JqZWN0LCBhcmdzKSB7XG4gICAgcmV0dXJuIFEob2JqZWN0KS5kaXNwYXRjaChcImFwcGx5XCIsIFt2b2lkIDAsIGFyZ3NdKTtcbn07XG5cblByb21pc2UucHJvdG90eXBlLmZhcHBseSA9IGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgcmV0dXJuIHRoaXMuZGlzcGF0Y2goXCJhcHBseVwiLCBbdm9pZCAwLCBhcmdzXSk7XG59O1xuXG4vKipcbiAqIENhbGxzIHRoZSBwcm9taXNlZCBmdW5jdGlvbiBpbiBhIGZ1dHVyZSB0dXJuLlxuICogQHBhcmFtIG9iamVjdCAgICBwcm9taXNlIG9yIGltbWVkaWF0ZSByZWZlcmVuY2UgZm9yIHRhcmdldCBmdW5jdGlvblxuICogQHBhcmFtIC4uLmFyZ3MgICBhcnJheSBvZiBhcHBsaWNhdGlvbiBhcmd1bWVudHNcbiAqL1xuUVtcInRyeVwiXSA9XG5RLmZjYWxsID0gZnVuY3Rpb24gKG9iamVjdCAvKiAuLi5hcmdzKi8pIHtcbiAgICByZXR1cm4gUShvYmplY3QpLmRpc3BhdGNoKFwiYXBwbHlcIiwgW3ZvaWQgMCwgYXJyYXlfc2xpY2UoYXJndW1lbnRzLCAxKV0pO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUuZmNhbGwgPSBmdW5jdGlvbiAoLyouLi5hcmdzKi8pIHtcbiAgICByZXR1cm4gdGhpcy5kaXNwYXRjaChcImFwcGx5XCIsIFt2b2lkIDAsIGFycmF5X3NsaWNlKGFyZ3VtZW50cyldKTtcbn07XG5cbi8qKlxuICogQmluZHMgdGhlIHByb21pc2VkIGZ1bmN0aW9uLCB0cmFuc2Zvcm1pbmcgcmV0dXJuIHZhbHVlcyBpbnRvIGEgZnVsZmlsbGVkXG4gKiBwcm9taXNlIGFuZCB0aHJvd24gZXJyb3JzIGludG8gYSByZWplY3RlZCBvbmUuXG4gKiBAcGFyYW0gb2JqZWN0ICAgIHByb21pc2Ugb3IgaW1tZWRpYXRlIHJlZmVyZW5jZSBmb3IgdGFyZ2V0IGZ1bmN0aW9uXG4gKiBAcGFyYW0gLi4uYXJncyAgIGFycmF5IG9mIGFwcGxpY2F0aW9uIGFyZ3VtZW50c1xuICovXG5RLmZiaW5kID0gZnVuY3Rpb24gKG9iamVjdCAvKi4uLmFyZ3MqLykge1xuICAgIHZhciBwcm9taXNlID0gUShvYmplY3QpO1xuICAgIHZhciBhcmdzID0gYXJyYXlfc2xpY2UoYXJndW1lbnRzLCAxKTtcbiAgICByZXR1cm4gZnVuY3Rpb24gZmJvdW5kKCkge1xuICAgICAgICByZXR1cm4gcHJvbWlzZS5kaXNwYXRjaChcImFwcGx5XCIsIFtcbiAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICBhcmdzLmNvbmNhdChhcnJheV9zbGljZShhcmd1bWVudHMpKVxuICAgICAgICBdKTtcbiAgICB9O1xufTtcblByb21pc2UucHJvdG90eXBlLmZiaW5kID0gZnVuY3Rpb24gKC8qLi4uYXJncyovKSB7XG4gICAgdmFyIHByb21pc2UgPSB0aGlzO1xuICAgIHZhciBhcmdzID0gYXJyYXlfc2xpY2UoYXJndW1lbnRzKTtcbiAgICByZXR1cm4gZnVuY3Rpb24gZmJvdW5kKCkge1xuICAgICAgICByZXR1cm4gcHJvbWlzZS5kaXNwYXRjaChcImFwcGx5XCIsIFtcbiAgICAgICAgICAgIHRoaXMsXG4gICAgICAgICAgICBhcmdzLmNvbmNhdChhcnJheV9zbGljZShhcmd1bWVudHMpKVxuICAgICAgICBdKTtcbiAgICB9O1xufTtcblxuLyoqXG4gKiBSZXF1ZXN0cyB0aGUgbmFtZXMgb2YgdGhlIG93bmVkIHByb3BlcnRpZXMgb2YgYSBwcm9taXNlZFxuICogb2JqZWN0IGluIGEgZnV0dXJlIHR1cm4uXG4gKiBAcGFyYW0gb2JqZWN0ICAgIHByb21pc2Ugb3IgaW1tZWRpYXRlIHJlZmVyZW5jZSBmb3IgdGFyZ2V0IG9iamVjdFxuICogQHJldHVybiBwcm9taXNlIGZvciB0aGUga2V5cyBvZiB0aGUgZXZlbnR1YWxseSBzZXR0bGVkIG9iamVjdFxuICovXG5RLmtleXMgPSBmdW5jdGlvbiAob2JqZWN0KSB7XG4gICAgcmV0dXJuIFEob2JqZWN0KS5kaXNwYXRjaChcImtleXNcIiwgW10pO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUua2V5cyA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcy5kaXNwYXRjaChcImtleXNcIiwgW10pO1xufTtcblxuLyoqXG4gKiBUdXJucyBhbiBhcnJheSBvZiBwcm9taXNlcyBpbnRvIGEgcHJvbWlzZSBmb3IgYW4gYXJyYXkuICBJZiBhbnkgb2ZcbiAqIHRoZSBwcm9taXNlcyBnZXRzIHJlamVjdGVkLCB0aGUgd2hvbGUgYXJyYXkgaXMgcmVqZWN0ZWQgaW1tZWRpYXRlbHkuXG4gKiBAcGFyYW0ge0FycmF5Kn0gYW4gYXJyYXkgKG9yIHByb21pc2UgZm9yIGFuIGFycmF5KSBvZiB2YWx1ZXMgKG9yXG4gKiBwcm9taXNlcyBmb3IgdmFsdWVzKVxuICogQHJldHVybnMgYSBwcm9taXNlIGZvciBhbiBhcnJheSBvZiB0aGUgY29ycmVzcG9uZGluZyB2YWx1ZXNcbiAqL1xuLy8gQnkgTWFyayBNaWxsZXJcbi8vIGh0dHA6Ly93aWtpLmVjbWFzY3JpcHQub3JnL2Rva3UucGhwP2lkPXN0cmF3bWFuOmNvbmN1cnJlbmN5JnJldj0xMzA4Nzc2NTIxI2FsbGZ1bGZpbGxlZFxuUS5hbGwgPSBhbGw7XG5mdW5jdGlvbiBhbGwocHJvbWlzZXMpIHtcbiAgICByZXR1cm4gd2hlbihwcm9taXNlcywgZnVuY3Rpb24gKHByb21pc2VzKSB7XG4gICAgICAgIHZhciBwZW5kaW5nQ291bnQgPSAwO1xuICAgICAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgICAgICBhcnJheV9yZWR1Y2UocHJvbWlzZXMsIGZ1bmN0aW9uICh1bmRlZmluZWQsIHByb21pc2UsIGluZGV4KSB7XG4gICAgICAgICAgICB2YXIgc25hcHNob3Q7XG4gICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgaXNQcm9taXNlKHByb21pc2UpICYmXG4gICAgICAgICAgICAgICAgKHNuYXBzaG90ID0gcHJvbWlzZS5pbnNwZWN0KCkpLnN0YXRlID09PSBcImZ1bGZpbGxlZFwiXG4gICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBwcm9taXNlc1tpbmRleF0gPSBzbmFwc2hvdC52YWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgKytwZW5kaW5nQ291bnQ7XG4gICAgICAgICAgICAgICAgd2hlbihcbiAgICAgICAgICAgICAgICAgICAgcHJvbWlzZSxcbiAgICAgICAgICAgICAgICAgICAgZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9taXNlc1tpbmRleF0gPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgtLXBlbmRpbmdDb3VudCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlZmVycmVkLnJlc29sdmUocHJvbWlzZXMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBkZWZlcnJlZC5yZWplY3QsXG4gICAgICAgICAgICAgICAgICAgIGZ1bmN0aW9uIChwcm9ncmVzcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVmZXJyZWQubm90aWZ5KHsgaW5kZXg6IGluZGV4LCB2YWx1ZTogcHJvZ3Jlc3MgfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LCB2b2lkIDApO1xuICAgICAgICBpZiAocGVuZGluZ0NvdW50ID09PSAwKSB7XG4gICAgICAgICAgICBkZWZlcnJlZC5yZXNvbHZlKHByb21pc2VzKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbiAgICB9KTtcbn1cblxuUHJvbWlzZS5wcm90b3R5cGUuYWxsID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBhbGwodGhpcyk7XG59O1xuXG4vKipcbiAqIFJldHVybnMgdGhlIGZpcnN0IHJlc29sdmVkIHByb21pc2Ugb2YgYW4gYXJyYXkuIFByaW9yIHJlamVjdGVkIHByb21pc2VzIGFyZVxuICogaWdub3JlZC4gIFJlamVjdHMgb25seSBpZiBhbGwgcHJvbWlzZXMgYXJlIHJlamVjdGVkLlxuICogQHBhcmFtIHtBcnJheSp9IGFuIGFycmF5IGNvbnRhaW5pbmcgdmFsdWVzIG9yIHByb21pc2VzIGZvciB2YWx1ZXNcbiAqIEByZXR1cm5zIGEgcHJvbWlzZSBmdWxmaWxsZWQgd2l0aCB0aGUgdmFsdWUgb2YgdGhlIGZpcnN0IHJlc29sdmVkIHByb21pc2UsXG4gKiBvciBhIHJlamVjdGVkIHByb21pc2UgaWYgYWxsIHByb21pc2VzIGFyZSByZWplY3RlZC5cbiAqL1xuUS5hbnkgPSBhbnk7XG5cbmZ1bmN0aW9uIGFueShwcm9taXNlcykge1xuICAgIGlmIChwcm9taXNlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIFEucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHZhciBkZWZlcnJlZCA9IFEuZGVmZXIoKTtcbiAgICB2YXIgcGVuZGluZ0NvdW50ID0gMDtcbiAgICBhcnJheV9yZWR1Y2UocHJvbWlzZXMsIGZ1bmN0aW9uIChwcmV2LCBjdXJyZW50LCBpbmRleCkge1xuICAgICAgICB2YXIgcHJvbWlzZSA9IHByb21pc2VzW2luZGV4XTtcblxuICAgICAgICBwZW5kaW5nQ291bnQrKztcblxuICAgICAgICB3aGVuKHByb21pc2UsIG9uRnVsZmlsbGVkLCBvblJlamVjdGVkLCBvblByb2dyZXNzKTtcbiAgICAgICAgZnVuY3Rpb24gb25GdWxmaWxsZWQocmVzdWx0KSB7XG4gICAgICAgICAgICBkZWZlcnJlZC5yZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgZnVuY3Rpb24gb25SZWplY3RlZCgpIHtcbiAgICAgICAgICAgIHBlbmRpbmdDb3VudC0tO1xuICAgICAgICAgICAgaWYgKHBlbmRpbmdDb3VudCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGRlZmVycmVkLnJlamVjdChuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgICAgIFwiQ2FuJ3QgZ2V0IGZ1bGZpbGxtZW50IHZhbHVlIGZyb20gYW55IHByb21pc2UsIGFsbCBcIiArXG4gICAgICAgICAgICAgICAgICAgIFwicHJvbWlzZXMgd2VyZSByZWplY3RlZC5cIlxuICAgICAgICAgICAgICAgICkpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGZ1bmN0aW9uIG9uUHJvZ3Jlc3MocHJvZ3Jlc3MpIHtcbiAgICAgICAgICAgIGRlZmVycmVkLm5vdGlmeSh7XG4gICAgICAgICAgICAgICAgaW5kZXg6IGluZGV4LFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwcm9ncmVzc1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9LCB1bmRlZmluZWQpO1xuXG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG59XG5cblByb21pc2UucHJvdG90eXBlLmFueSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gYW55KHRoaXMpO1xufTtcblxuLyoqXG4gKiBXYWl0cyBmb3IgYWxsIHByb21pc2VzIHRvIGJlIHNldHRsZWQsIGVpdGhlciBmdWxmaWxsZWQgb3JcbiAqIHJlamVjdGVkLiAgVGhpcyBpcyBkaXN0aW5jdCBmcm9tIGBhbGxgIHNpbmNlIHRoYXQgd291bGQgc3RvcFxuICogd2FpdGluZyBhdCB0aGUgZmlyc3QgcmVqZWN0aW9uLiAgVGhlIHByb21pc2UgcmV0dXJuZWQgYnlcbiAqIGBhbGxSZXNvbHZlZGAgd2lsbCBuZXZlciBiZSByZWplY3RlZC5cbiAqIEBwYXJhbSBwcm9taXNlcyBhIHByb21pc2UgZm9yIGFuIGFycmF5IChvciBhbiBhcnJheSkgb2YgcHJvbWlzZXNcbiAqIChvciB2YWx1ZXMpXG4gKiBAcmV0dXJuIGEgcHJvbWlzZSBmb3IgYW4gYXJyYXkgb2YgcHJvbWlzZXNcbiAqL1xuUS5hbGxSZXNvbHZlZCA9IGRlcHJlY2F0ZShhbGxSZXNvbHZlZCwgXCJhbGxSZXNvbHZlZFwiLCBcImFsbFNldHRsZWRcIik7XG5mdW5jdGlvbiBhbGxSZXNvbHZlZChwcm9taXNlcykge1xuICAgIHJldHVybiB3aGVuKHByb21pc2VzLCBmdW5jdGlvbiAocHJvbWlzZXMpIHtcbiAgICAgICAgcHJvbWlzZXMgPSBhcnJheV9tYXAocHJvbWlzZXMsIFEpO1xuICAgICAgICByZXR1cm4gd2hlbihhbGwoYXJyYXlfbWFwKHByb21pc2VzLCBmdW5jdGlvbiAocHJvbWlzZSkge1xuICAgICAgICAgICAgcmV0dXJuIHdoZW4ocHJvbWlzZSwgbm9vcCwgbm9vcCk7XG4gICAgICAgIH0pKSwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIHByb21pc2VzO1xuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxuUHJvbWlzZS5wcm90b3R5cGUuYWxsUmVzb2x2ZWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIGFsbFJlc29sdmVkKHRoaXMpO1xufTtcblxuLyoqXG4gKiBAc2VlIFByb21pc2UjYWxsU2V0dGxlZFxuICovXG5RLmFsbFNldHRsZWQgPSBhbGxTZXR0bGVkO1xuZnVuY3Rpb24gYWxsU2V0dGxlZChwcm9taXNlcykge1xuICAgIHJldHVybiBRKHByb21pc2VzKS5hbGxTZXR0bGVkKCk7XG59XG5cbi8qKlxuICogVHVybnMgYW4gYXJyYXkgb2YgcHJvbWlzZXMgaW50byBhIHByb21pc2UgZm9yIGFuIGFycmF5IG9mIHRoZWlyIHN0YXRlcyAoYXNcbiAqIHJldHVybmVkIGJ5IGBpbnNwZWN0YCkgd2hlbiB0aGV5IGhhdmUgYWxsIHNldHRsZWQuXG4gKiBAcGFyYW0ge0FycmF5W0FueSpdfSB2YWx1ZXMgYW4gYXJyYXkgKG9yIHByb21pc2UgZm9yIGFuIGFycmF5KSBvZiB2YWx1ZXMgKG9yXG4gKiBwcm9taXNlcyBmb3IgdmFsdWVzKVxuICogQHJldHVybnMge0FycmF5W1N0YXRlXX0gYW4gYXJyYXkgb2Ygc3RhdGVzIGZvciB0aGUgcmVzcGVjdGl2ZSB2YWx1ZXMuXG4gKi9cblByb21pc2UucHJvdG90eXBlLmFsbFNldHRsZWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXMudGhlbihmdW5jdGlvbiAocHJvbWlzZXMpIHtcbiAgICAgICAgcmV0dXJuIGFsbChhcnJheV9tYXAocHJvbWlzZXMsIGZ1bmN0aW9uIChwcm9taXNlKSB7XG4gICAgICAgICAgICBwcm9taXNlID0gUShwcm9taXNlKTtcbiAgICAgICAgICAgIGZ1bmN0aW9uIHJlZ2FyZGxlc3MoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHByb21pc2UuaW5zcGVjdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbihyZWdhcmRsZXNzLCByZWdhcmRsZXNzKTtcbiAgICAgICAgfSkpO1xuICAgIH0pO1xufTtcblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgZmFpbHVyZSBvZiBhIHByb21pc2UsIGdpdmluZyBhbiBvcG9ydHVuaXR5IHRvIHJlY292ZXJcbiAqIHdpdGggYSBjYWxsYmFjay4gIElmIHRoZSBnaXZlbiBwcm9taXNlIGlzIGZ1bGZpbGxlZCwgdGhlIHJldHVybmVkXG4gKiBwcm9taXNlIGlzIGZ1bGZpbGxlZC5cbiAqIEBwYXJhbSB7QW55Kn0gcHJvbWlzZSBmb3Igc29tZXRoaW5nXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayB0byBmdWxmaWxsIHRoZSByZXR1cm5lZCBwcm9taXNlIGlmIHRoZVxuICogZ2l2ZW4gcHJvbWlzZSBpcyByZWplY3RlZFxuICogQHJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgcmV0dXJuIHZhbHVlIG9mIHRoZSBjYWxsYmFja1xuICovXG5RLmZhaWwgPSAvLyBYWFggbGVnYWN5XG5RW1wiY2F0Y2hcIl0gPSBmdW5jdGlvbiAob2JqZWN0LCByZWplY3RlZCkge1xuICAgIHJldHVybiBRKG9iamVjdCkudGhlbih2b2lkIDAsIHJlamVjdGVkKTtcbn07XG5cblByb21pc2UucHJvdG90eXBlLmZhaWwgPSAvLyBYWFggbGVnYWN5XG5Qcm9taXNlLnByb3RvdHlwZVtcImNhdGNoXCJdID0gZnVuY3Rpb24gKHJlamVjdGVkKSB7XG4gICAgcmV0dXJuIHRoaXMudGhlbih2b2lkIDAsIHJlamVjdGVkKTtcbn07XG5cbi8qKlxuICogQXR0YWNoZXMgYSBsaXN0ZW5lciB0aGF0IGNhbiByZXNwb25kIHRvIHByb2dyZXNzIG5vdGlmaWNhdGlvbnMgZnJvbSBhXG4gKiBwcm9taXNlJ3Mgb3JpZ2luYXRpbmcgZGVmZXJyZWQuIFRoaXMgbGlzdGVuZXIgcmVjZWl2ZXMgdGhlIGV4YWN0IGFyZ3VtZW50c1xuICogcGFzc2VkIHRvIGBgZGVmZXJyZWQubm90aWZ5YGAuXG4gKiBAcGFyYW0ge0FueSp9IHByb21pc2UgZm9yIHNvbWV0aGluZ1xuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgdG8gcmVjZWl2ZSBhbnkgcHJvZ3Jlc3Mgbm90aWZpY2F0aW9uc1xuICogQHJldHVybnMgdGhlIGdpdmVuIHByb21pc2UsIHVuY2hhbmdlZFxuICovXG5RLnByb2dyZXNzID0gcHJvZ3Jlc3M7XG5mdW5jdGlvbiBwcm9ncmVzcyhvYmplY3QsIHByb2dyZXNzZWQpIHtcbiAgICByZXR1cm4gUShvYmplY3QpLnRoZW4odm9pZCAwLCB2b2lkIDAsIHByb2dyZXNzZWQpO1xufVxuXG5Qcm9taXNlLnByb3RvdHlwZS5wcm9ncmVzcyA9IGZ1bmN0aW9uIChwcm9ncmVzc2VkKSB7XG4gICAgcmV0dXJuIHRoaXMudGhlbih2b2lkIDAsIHZvaWQgMCwgcHJvZ3Jlc3NlZCk7XG59O1xuXG4vKipcbiAqIFByb3ZpZGVzIGFuIG9wcG9ydHVuaXR5IHRvIG9ic2VydmUgdGhlIHNldHRsaW5nIG9mIGEgcHJvbWlzZSxcbiAqIHJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGUgcHJvbWlzZSBpcyBmdWxmaWxsZWQgb3IgcmVqZWN0ZWQuICBGb3J3YXJkc1xuICogdGhlIHJlc29sdXRpb24gdG8gdGhlIHJldHVybmVkIHByb21pc2Ugd2hlbiB0aGUgY2FsbGJhY2sgaXMgZG9uZS5cbiAqIFRoZSBjYWxsYmFjayBjYW4gcmV0dXJuIGEgcHJvbWlzZSB0byBkZWZlciBjb21wbGV0aW9uLlxuICogQHBhcmFtIHtBbnkqfSBwcm9taXNlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayB0byBvYnNlcnZlIHRoZSByZXNvbHV0aW9uIG9mIHRoZSBnaXZlblxuICogcHJvbWlzZSwgdGFrZXMgbm8gYXJndW1lbnRzLlxuICogQHJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgcmVzb2x1dGlvbiBvZiB0aGUgZ2l2ZW4gcHJvbWlzZSB3aGVuXG4gKiBgYGZpbmBgIGlzIGRvbmUuXG4gKi9cblEuZmluID0gLy8gWFhYIGxlZ2FjeVxuUVtcImZpbmFsbHlcIl0gPSBmdW5jdGlvbiAob2JqZWN0LCBjYWxsYmFjaykge1xuICAgIHJldHVybiBRKG9iamVjdClbXCJmaW5hbGx5XCJdKGNhbGxiYWNrKTtcbn07XG5cblByb21pc2UucHJvdG90eXBlLmZpbiA9IC8vIFhYWCBsZWdhY3lcblByb21pc2UucHJvdG90eXBlW1wiZmluYWxseVwiXSA9IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgIGNhbGxiYWNrID0gUShjYWxsYmFjayk7XG4gICAgcmV0dXJuIHRoaXMudGhlbihmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmZjYWxsKCkudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICAgIH0pO1xuICAgIH0sIGZ1bmN0aW9uIChyZWFzb24pIHtcbiAgICAgICAgLy8gVE9ETyBhdHRlbXB0IHRvIHJlY3ljbGUgdGhlIHJlamVjdGlvbiB3aXRoIFwidGhpc1wiLlxuICAgICAgICByZXR1cm4gY2FsbGJhY2suZmNhbGwoKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHRocm93IHJlYXNvbjtcbiAgICAgICAgfSk7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqIFRlcm1pbmF0ZXMgYSBjaGFpbiBvZiBwcm9taXNlcywgZm9yY2luZyByZWplY3Rpb25zIHRvIGJlXG4gKiB0aHJvd24gYXMgZXhjZXB0aW9ucy5cbiAqIEBwYXJhbSB7QW55Kn0gcHJvbWlzZSBhdCB0aGUgZW5kIG9mIGEgY2hhaW4gb2YgcHJvbWlzZXNcbiAqIEByZXR1cm5zIG5vdGhpbmdcbiAqL1xuUS5kb25lID0gZnVuY3Rpb24gKG9iamVjdCwgZnVsZmlsbGVkLCByZWplY3RlZCwgcHJvZ3Jlc3MpIHtcbiAgICByZXR1cm4gUShvYmplY3QpLmRvbmUoZnVsZmlsbGVkLCByZWplY3RlZCwgcHJvZ3Jlc3MpO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUuZG9uZSA9IGZ1bmN0aW9uIChmdWxmaWxsZWQsIHJlamVjdGVkLCBwcm9ncmVzcykge1xuICAgIHZhciBvblVuaGFuZGxlZEVycm9yID0gZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICAgIC8vIGZvcndhcmQgdG8gYSBmdXR1cmUgdHVybiBzbyB0aGF0IGBgd2hlbmBgXG4gICAgICAgIC8vIGRvZXMgbm90IGNhdGNoIGl0IGFuZCB0dXJuIGl0IGludG8gYSByZWplY3Rpb24uXG4gICAgICAgIFEubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgbWFrZVN0YWNrVHJhY2VMb25nKGVycm9yLCBwcm9taXNlKTtcbiAgICAgICAgICAgIGlmIChRLm9uZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBRLm9uZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIEF2b2lkIHVubmVjZXNzYXJ5IGBuZXh0VGlja2BpbmcgdmlhIGFuIHVubmVjZXNzYXJ5IGB3aGVuYC5cbiAgICB2YXIgcHJvbWlzZSA9IGZ1bGZpbGxlZCB8fCByZWplY3RlZCB8fCBwcm9ncmVzcyA/XG4gICAgICAgIHRoaXMudGhlbihmdWxmaWxsZWQsIHJlamVjdGVkLCBwcm9ncmVzcykgOlxuICAgICAgICB0aGlzO1xuXG4gICAgaWYgKHR5cGVvZiBwcm9jZXNzID09PSBcIm9iamVjdFwiICYmIHByb2Nlc3MgJiYgcHJvY2Vzcy5kb21haW4pIHtcbiAgICAgICAgb25VbmhhbmRsZWRFcnJvciA9IHByb2Nlc3MuZG9tYWluLmJpbmQob25VbmhhbmRsZWRFcnJvcik7XG4gICAgfVxuXG4gICAgcHJvbWlzZS50aGVuKHZvaWQgMCwgb25VbmhhbmRsZWRFcnJvcik7XG59O1xuXG4vKipcbiAqIENhdXNlcyBhIHByb21pc2UgdG8gYmUgcmVqZWN0ZWQgaWYgaXQgZG9lcyBub3QgZ2V0IGZ1bGZpbGxlZCBiZWZvcmVcbiAqIHNvbWUgbWlsbGlzZWNvbmRzIHRpbWUgb3V0LlxuICogQHBhcmFtIHtBbnkqfSBwcm9taXNlXG4gKiBAcGFyYW0ge051bWJlcn0gbWlsbGlzZWNvbmRzIHRpbWVvdXRcbiAqIEBwYXJhbSB7QW55Kn0gY3VzdG9tIGVycm9yIG1lc3NhZ2Ugb3IgRXJyb3Igb2JqZWN0IChvcHRpb25hbClcbiAqIEByZXR1cm5zIGEgcHJvbWlzZSBmb3IgdGhlIHJlc29sdXRpb24gb2YgdGhlIGdpdmVuIHByb21pc2UgaWYgaXQgaXNcbiAqIGZ1bGZpbGxlZCBiZWZvcmUgdGhlIHRpbWVvdXQsIG90aGVyd2lzZSByZWplY3RlZC5cbiAqL1xuUS50aW1lb3V0ID0gZnVuY3Rpb24gKG9iamVjdCwgbXMsIGVycm9yKSB7XG4gICAgcmV0dXJuIFEob2JqZWN0KS50aW1lb3V0KG1zLCBlcnJvcik7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS50aW1lb3V0ID0gZnVuY3Rpb24gKG1zLCBlcnJvcikge1xuICAgIHZhciBkZWZlcnJlZCA9IGRlZmVyKCk7XG4gICAgdmFyIHRpbWVvdXRJZCA9IHNldFRpbWVvdXQoZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoIWVycm9yIHx8IFwic3RyaW5nXCIgPT09IHR5cGVvZiBlcnJvcikge1xuICAgICAgICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoZXJyb3IgfHwgXCJUaW1lZCBvdXQgYWZ0ZXIgXCIgKyBtcyArIFwiIG1zXCIpO1xuICAgICAgICAgICAgZXJyb3IuY29kZSA9IFwiRVRJTUVET1VUXCI7XG4gICAgICAgIH1cbiAgICAgICAgZGVmZXJyZWQucmVqZWN0KGVycm9yKTtcbiAgICB9LCBtcyk7XG5cbiAgICB0aGlzLnRoZW4oZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpO1xuICAgICAgICBkZWZlcnJlZC5yZXNvbHZlKHZhbHVlKTtcbiAgICB9LCBmdW5jdGlvbiAoZXhjZXB0aW9uKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpO1xuICAgICAgICBkZWZlcnJlZC5yZWplY3QoZXhjZXB0aW9uKTtcbiAgICB9LCBkZWZlcnJlZC5ub3RpZnkpO1xuXG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG59O1xuXG4vKipcbiAqIFJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgZ2l2ZW4gdmFsdWUgKG9yIHByb21pc2VkIHZhbHVlKSwgc29tZVxuICogbWlsbGlzZWNvbmRzIGFmdGVyIGl0IHJlc29sdmVkLiBQYXNzZXMgcmVqZWN0aW9ucyBpbW1lZGlhdGVseS5cbiAqIEBwYXJhbSB7QW55Kn0gcHJvbWlzZVxuICogQHBhcmFtIHtOdW1iZXJ9IG1pbGxpc2Vjb25kc1xuICogQHJldHVybnMgYSBwcm9taXNlIGZvciB0aGUgcmVzb2x1dGlvbiBvZiB0aGUgZ2l2ZW4gcHJvbWlzZSBhZnRlciBtaWxsaXNlY29uZHNcbiAqIHRpbWUgaGFzIGVsYXBzZWQgc2luY2UgdGhlIHJlc29sdXRpb24gb2YgdGhlIGdpdmVuIHByb21pc2UuXG4gKiBJZiB0aGUgZ2l2ZW4gcHJvbWlzZSByZWplY3RzLCB0aGF0IGlzIHBhc3NlZCBpbW1lZGlhdGVseS5cbiAqL1xuUS5kZWxheSA9IGZ1bmN0aW9uIChvYmplY3QsIHRpbWVvdXQpIHtcbiAgICBpZiAodGltZW91dCA9PT0gdm9pZCAwKSB7XG4gICAgICAgIHRpbWVvdXQgPSBvYmplY3Q7XG4gICAgICAgIG9iamVjdCA9IHZvaWQgMDtcbiAgICB9XG4gICAgcmV0dXJuIFEob2JqZWN0KS5kZWxheSh0aW1lb3V0KTtcbn07XG5cblByb21pc2UucHJvdG90eXBlLmRlbGF5ID0gZnVuY3Rpb24gKHRpbWVvdXQpIHtcbiAgICByZXR1cm4gdGhpcy50aGVuKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGRlZmVycmVkLnJlc29sdmUodmFsdWUpO1xuICAgICAgICB9LCB0aW1lb3V0KTtcbiAgICAgICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG4gICAgfSk7XG59O1xuXG4vKipcbiAqIFBhc3NlcyBhIGNvbnRpbnVhdGlvbiB0byBhIE5vZGUgZnVuY3Rpb24sIHdoaWNoIGlzIGNhbGxlZCB3aXRoIHRoZSBnaXZlblxuICogYXJndW1lbnRzIHByb3ZpZGVkIGFzIGFuIGFycmF5LCBhbmQgcmV0dXJucyBhIHByb21pc2UuXG4gKlxuICogICAgICBRLm5mYXBwbHkoRlMucmVhZEZpbGUsIFtfX2ZpbGVuYW1lXSlcbiAqICAgICAgLnRoZW4oZnVuY3Rpb24gKGNvbnRlbnQpIHtcbiAqICAgICAgfSlcbiAqXG4gKi9cblEubmZhcHBseSA9IGZ1bmN0aW9uIChjYWxsYmFjaywgYXJncykge1xuICAgIHJldHVybiBRKGNhbGxiYWNrKS5uZmFwcGx5KGFyZ3MpO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUubmZhcHBseSA9IGZ1bmN0aW9uIChhcmdzKSB7XG4gICAgdmFyIGRlZmVycmVkID0gZGVmZXIoKTtcbiAgICB2YXIgbm9kZUFyZ3MgPSBhcnJheV9zbGljZShhcmdzKTtcbiAgICBub2RlQXJncy5wdXNoKGRlZmVycmVkLm1ha2VOb2RlUmVzb2x2ZXIoKSk7XG4gICAgdGhpcy5mYXBwbHkobm9kZUFyZ3MpLmZhaWwoZGVmZXJyZWQucmVqZWN0KTtcbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbn07XG5cbi8qKlxuICogUGFzc2VzIGEgY29udGludWF0aW9uIHRvIGEgTm9kZSBmdW5jdGlvbiwgd2hpY2ggaXMgY2FsbGVkIHdpdGggdGhlIGdpdmVuXG4gKiBhcmd1bWVudHMgcHJvdmlkZWQgaW5kaXZpZHVhbGx5LCBhbmQgcmV0dXJucyBhIHByb21pc2UuXG4gKiBAZXhhbXBsZVxuICogUS5uZmNhbGwoRlMucmVhZEZpbGUsIF9fZmlsZW5hbWUpXG4gKiAudGhlbihmdW5jdGlvbiAoY29udGVudCkge1xuICogfSlcbiAqXG4gKi9cblEubmZjYWxsID0gZnVuY3Rpb24gKGNhbGxiYWNrIC8qLi4uYXJncyovKSB7XG4gICAgdmFyIGFyZ3MgPSBhcnJheV9zbGljZShhcmd1bWVudHMsIDEpO1xuICAgIHJldHVybiBRKGNhbGxiYWNrKS5uZmFwcGx5KGFyZ3MpO1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUubmZjYWxsID0gZnVuY3Rpb24gKC8qLi4uYXJncyovKSB7XG4gICAgdmFyIG5vZGVBcmdzID0gYXJyYXlfc2xpY2UoYXJndW1lbnRzKTtcbiAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgIG5vZGVBcmdzLnB1c2goZGVmZXJyZWQubWFrZU5vZGVSZXNvbHZlcigpKTtcbiAgICB0aGlzLmZhcHBseShub2RlQXJncykuZmFpbChkZWZlcnJlZC5yZWplY3QpO1xuICAgIHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xufTtcblxuLyoqXG4gKiBXcmFwcyBhIE5vZGVKUyBjb250aW51YXRpb24gcGFzc2luZyBmdW5jdGlvbiBhbmQgcmV0dXJucyBhbiBlcXVpdmFsZW50XG4gKiB2ZXJzaW9uIHRoYXQgcmV0dXJucyBhIHByb21pc2UuXG4gKiBAZXhhbXBsZVxuICogUS5uZmJpbmQoRlMucmVhZEZpbGUsIF9fZmlsZW5hbWUpKFwidXRmLThcIilcbiAqIC50aGVuKGNvbnNvbGUubG9nKVxuICogLmRvbmUoKVxuICovXG5RLm5mYmluZCA9XG5RLmRlbm9kZWlmeSA9IGZ1bmN0aW9uIChjYWxsYmFjayAvKi4uLmFyZ3MqLykge1xuICAgIHZhciBiYXNlQXJncyA9IGFycmF5X3NsaWNlKGFyZ3VtZW50cywgMSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIG5vZGVBcmdzID0gYmFzZUFyZ3MuY29uY2F0KGFycmF5X3NsaWNlKGFyZ3VtZW50cykpO1xuICAgICAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgICAgICBub2RlQXJncy5wdXNoKGRlZmVycmVkLm1ha2VOb2RlUmVzb2x2ZXIoKSk7XG4gICAgICAgIFEoY2FsbGJhY2spLmZhcHBseShub2RlQXJncykuZmFpbChkZWZlcnJlZC5yZWplY3QpO1xuICAgICAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbiAgICB9O1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUubmZiaW5kID1cblByb21pc2UucHJvdG90eXBlLmRlbm9kZWlmeSA9IGZ1bmN0aW9uICgvKi4uLmFyZ3MqLykge1xuICAgIHZhciBhcmdzID0gYXJyYXlfc2xpY2UoYXJndW1lbnRzKTtcbiAgICBhcmdzLnVuc2hpZnQodGhpcyk7XG4gICAgcmV0dXJuIFEuZGVub2RlaWZ5LmFwcGx5KHZvaWQgMCwgYXJncyk7XG59O1xuXG5RLm5iaW5kID0gZnVuY3Rpb24gKGNhbGxiYWNrLCB0aGlzcCAvKi4uLmFyZ3MqLykge1xuICAgIHZhciBiYXNlQXJncyA9IGFycmF5X3NsaWNlKGFyZ3VtZW50cywgMik7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgdmFyIG5vZGVBcmdzID0gYmFzZUFyZ3MuY29uY2F0KGFycmF5X3NsaWNlKGFyZ3VtZW50cykpO1xuICAgICAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgICAgICBub2RlQXJncy5wdXNoKGRlZmVycmVkLm1ha2VOb2RlUmVzb2x2ZXIoKSk7XG4gICAgICAgIGZ1bmN0aW9uIGJvdW5kKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrLmFwcGx5KHRoaXNwLCBhcmd1bWVudHMpO1xuICAgICAgICB9XG4gICAgICAgIFEoYm91bmQpLmZhcHBseShub2RlQXJncykuZmFpbChkZWZlcnJlZC5yZWplY3QpO1xuICAgICAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbiAgICB9O1xufTtcblxuUHJvbWlzZS5wcm90b3R5cGUubmJpbmQgPSBmdW5jdGlvbiAoLyp0aGlzcCwgLi4uYXJncyovKSB7XG4gICAgdmFyIGFyZ3MgPSBhcnJheV9zbGljZShhcmd1bWVudHMsIDApO1xuICAgIGFyZ3MudW5zaGlmdCh0aGlzKTtcbiAgICByZXR1cm4gUS5uYmluZC5hcHBseSh2b2lkIDAsIGFyZ3MpO1xufTtcblxuLyoqXG4gKiBDYWxscyBhIG1ldGhvZCBvZiBhIE5vZGUtc3R5bGUgb2JqZWN0IHRoYXQgYWNjZXB0cyBhIE5vZGUtc3R5bGVcbiAqIGNhbGxiYWNrIHdpdGggYSBnaXZlbiBhcnJheSBvZiBhcmd1bWVudHMsIHBsdXMgYSBwcm92aWRlZCBjYWxsYmFjay5cbiAqIEBwYXJhbSBvYmplY3QgYW4gb2JqZWN0IHRoYXQgaGFzIHRoZSBuYW1lZCBtZXRob2RcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIG5hbWUgb2YgdGhlIG1ldGhvZCBvZiBvYmplY3RcbiAqIEBwYXJhbSB7QXJyYXl9IGFyZ3MgYXJndW1lbnRzIHRvIHBhc3MgdG8gdGhlIG1ldGhvZDsgdGhlIGNhbGxiYWNrXG4gKiB3aWxsIGJlIHByb3ZpZGVkIGJ5IFEgYW5kIGFwcGVuZGVkIHRvIHRoZXNlIGFyZ3VtZW50cy5cbiAqIEByZXR1cm5zIGEgcHJvbWlzZSBmb3IgdGhlIHZhbHVlIG9yIGVycm9yXG4gKi9cblEubm1hcHBseSA9IC8vIFhYWCBBcyBwcm9wb3NlZCBieSBcIlJlZHNhbmRyb1wiXG5RLm5wb3N0ID0gZnVuY3Rpb24gKG9iamVjdCwgbmFtZSwgYXJncykge1xuICAgIHJldHVybiBRKG9iamVjdCkubnBvc3QobmFtZSwgYXJncyk7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS5ubWFwcGx5ID0gLy8gWFhYIEFzIHByb3Bvc2VkIGJ5IFwiUmVkc2FuZHJvXCJcblByb21pc2UucHJvdG90eXBlLm5wb3N0ID0gZnVuY3Rpb24gKG5hbWUsIGFyZ3MpIHtcbiAgICB2YXIgbm9kZUFyZ3MgPSBhcnJheV9zbGljZShhcmdzIHx8IFtdKTtcbiAgICB2YXIgZGVmZXJyZWQgPSBkZWZlcigpO1xuICAgIG5vZGVBcmdzLnB1c2goZGVmZXJyZWQubWFrZU5vZGVSZXNvbHZlcigpKTtcbiAgICB0aGlzLmRpc3BhdGNoKFwicG9zdFwiLCBbbmFtZSwgbm9kZUFyZ3NdKS5mYWlsKGRlZmVycmVkLnJlamVjdCk7XG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG59O1xuXG4vKipcbiAqIENhbGxzIGEgbWV0aG9kIG9mIGEgTm9kZS1zdHlsZSBvYmplY3QgdGhhdCBhY2NlcHRzIGEgTm9kZS1zdHlsZVxuICogY2FsbGJhY2ssIGZvcndhcmRpbmcgdGhlIGdpdmVuIHZhcmlhZGljIGFyZ3VtZW50cywgcGx1cyBhIHByb3ZpZGVkXG4gKiBjYWxsYmFjayBhcmd1bWVudC5cbiAqIEBwYXJhbSBvYmplY3QgYW4gb2JqZWN0IHRoYXQgaGFzIHRoZSBuYW1lZCBtZXRob2RcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIG5hbWUgb2YgdGhlIG1ldGhvZCBvZiBvYmplY3RcbiAqIEBwYXJhbSAuLi5hcmdzIGFyZ3VtZW50cyB0byBwYXNzIHRvIHRoZSBtZXRob2Q7IHRoZSBjYWxsYmFjayB3aWxsXG4gKiBiZSBwcm92aWRlZCBieSBRIGFuZCBhcHBlbmRlZCB0byB0aGVzZSBhcmd1bWVudHMuXG4gKiBAcmV0dXJucyBhIHByb21pc2UgZm9yIHRoZSB2YWx1ZSBvciBlcnJvclxuICovXG5RLm5zZW5kID0gLy8gWFhYIEJhc2VkIG9uIE1hcmsgTWlsbGVyJ3MgcHJvcG9zZWQgXCJzZW5kXCJcblEubm1jYWxsID0gLy8gWFhYIEJhc2VkIG9uIFwiUmVkc2FuZHJvJ3NcIiBwcm9wb3NhbFxuUS5uaW52b2tlID0gZnVuY3Rpb24gKG9iamVjdCwgbmFtZSAvKi4uLmFyZ3MqLykge1xuICAgIHZhciBub2RlQXJncyA9IGFycmF5X3NsaWNlKGFyZ3VtZW50cywgMik7XG4gICAgdmFyIGRlZmVycmVkID0gZGVmZXIoKTtcbiAgICBub2RlQXJncy5wdXNoKGRlZmVycmVkLm1ha2VOb2RlUmVzb2x2ZXIoKSk7XG4gICAgUShvYmplY3QpLmRpc3BhdGNoKFwicG9zdFwiLCBbbmFtZSwgbm9kZUFyZ3NdKS5mYWlsKGRlZmVycmVkLnJlamVjdCk7XG4gICAgcmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS5uc2VuZCA9IC8vIFhYWCBCYXNlZCBvbiBNYXJrIE1pbGxlcidzIHByb3Bvc2VkIFwic2VuZFwiXG5Qcm9taXNlLnByb3RvdHlwZS5ubWNhbGwgPSAvLyBYWFggQmFzZWQgb24gXCJSZWRzYW5kcm8nc1wiIHByb3Bvc2FsXG5Qcm9taXNlLnByb3RvdHlwZS5uaW52b2tlID0gZnVuY3Rpb24gKG5hbWUgLyouLi5hcmdzKi8pIHtcbiAgICB2YXIgbm9kZUFyZ3MgPSBhcnJheV9zbGljZShhcmd1bWVudHMsIDEpO1xuICAgIHZhciBkZWZlcnJlZCA9IGRlZmVyKCk7XG4gICAgbm9kZUFyZ3MucHVzaChkZWZlcnJlZC5tYWtlTm9kZVJlc29sdmVyKCkpO1xuICAgIHRoaXMuZGlzcGF0Y2goXCJwb3N0XCIsIFtuYW1lLCBub2RlQXJnc10pLmZhaWwoZGVmZXJyZWQucmVqZWN0KTtcbiAgICByZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcbn07XG5cbi8qKlxuICogSWYgYSBmdW5jdGlvbiB3b3VsZCBsaWtlIHRvIHN1cHBvcnQgYm90aCBOb2RlIGNvbnRpbnVhdGlvbi1wYXNzaW5nLXN0eWxlIGFuZFxuICogcHJvbWlzZS1yZXR1cm5pbmctc3R5bGUsIGl0IGNhbiBlbmQgaXRzIGludGVybmFsIHByb21pc2UgY2hhaW4gd2l0aFxuICogYG5vZGVpZnkobm9kZWJhY2spYCwgZm9yd2FyZGluZyB0aGUgb3B0aW9uYWwgbm9kZWJhY2sgYXJndW1lbnQuICBJZiB0aGUgdXNlclxuICogZWxlY3RzIHRvIHVzZSBhIG5vZGViYWNrLCB0aGUgcmVzdWx0IHdpbGwgYmUgc2VudCB0aGVyZS4gIElmIHRoZXkgZG8gbm90XG4gKiBwYXNzIGEgbm9kZWJhY2ssIHRoZXkgd2lsbCByZWNlaXZlIHRoZSByZXN1bHQgcHJvbWlzZS5cbiAqIEBwYXJhbSBvYmplY3QgYSByZXN1bHQgKG9yIGEgcHJvbWlzZSBmb3IgYSByZXN1bHQpXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBub2RlYmFjayBhIE5vZGUuanMtc3R5bGUgY2FsbGJhY2tcbiAqIEByZXR1cm5zIGVpdGhlciB0aGUgcHJvbWlzZSBvciBub3RoaW5nXG4gKi9cblEubm9kZWlmeSA9IG5vZGVpZnk7XG5mdW5jdGlvbiBub2RlaWZ5KG9iamVjdCwgbm9kZWJhY2spIHtcbiAgICByZXR1cm4gUShvYmplY3QpLm5vZGVpZnkobm9kZWJhY2spO1xufVxuXG5Qcm9taXNlLnByb3RvdHlwZS5ub2RlaWZ5ID0gZnVuY3Rpb24gKG5vZGViYWNrKSB7XG4gICAgaWYgKG5vZGViYWNrKSB7XG4gICAgICAgIHRoaXMudGhlbihmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgICAgICAgIFEubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIG5vZGViYWNrKG51bGwsIHZhbHVlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgICAgIFEubmV4dFRpY2soZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIG5vZGViYWNrKGVycm9yKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG59O1xuXG5RLm5vQ29uZmxpY3QgPSBmdW5jdGlvbigpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJRLm5vQ29uZmxpY3Qgb25seSB3b3JrcyB3aGVuIFEgaXMgdXNlZCBhcyBhIGdsb2JhbFwiKTtcbn07XG5cbi8vIEFsbCBjb2RlIGJlZm9yZSB0aGlzIHBvaW50IHdpbGwgYmUgZmlsdGVyZWQgZnJvbSBzdGFjayB0cmFjZXMuXG52YXIgcUVuZGluZ0xpbmUgPSBjYXB0dXJlTGluZSgpO1xuXG5yZXR1cm4gUTtcblxufSk7XG4iLCJ2YXIgd29yayA9IHJlcXVpcmUoJ3dlYndvcmtpZnknKTtcbnZhciB0b2pzb24gPSByZXF1aXJlKCduZ3JhcGgudG9qc29uJyk7XG52YXIgZXZlbnRpZnkgPSByZXF1aXJlKCduZ3JhcGguZXZlbnRzJyk7XG5cbnZhciBjcmVhdGVMYXlvdXQgPSByZXF1aXJlKCcuL2xpYi9jcmVhdGVMYXlvdXQuanMnKTtcbnZhciB2YWxpZGF0ZU9wdGlvbnMgPSByZXF1aXJlKCcuL29wdGlvbnMuanMnKTtcbnZhciBtZXNzYWdlS2luZCA9IHJlcXVpcmUoJy4vbGliL21lc3NhZ2VzLmpzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlQXN5bmNMYXlvdXQ7XG5cbmZ1bmN0aW9uIGNyZWF0ZUFzeW5jTGF5b3V0KGdyYXBoLCBvcHRpb25zKSB7XG4gIG9wdGlvbnMgPSB2YWxpZGF0ZU9wdGlvbnMob3B0aW9ucyk7XG5cbiAgdmFyIGFzc2lnblBvc2l0aW9uID0gb3B0aW9ucy5pczNkID8gYXNzaWduUG9zaXRpb24zZCA6IGFzc2lnblBvc2l0aW9uMmQ7XG5cbiAgdmFyIHBlbmRpbmdJbml0aWFsaXphdGlvbiA9IGZhbHNlO1xuICB2YXIgaW5pdFJlcXVlc3RTZW50ID0gZmFsc2U7XG4gIHZhciBzeXN0ZW1TdGFibGUgPSBmYWxzZTtcbiAgdmFyIGdyYXBoUmVjdDtcbiAgdmFyIHBpblN0YXR1cyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHZhciBsaW5rUG9zaXRpb25zO1xuXG4gIC8vIFNpbmNlIHRoaXMgaXMgZmFpcmx5IGNvbW1vbiBtZXNzYWdlLCB0aGVyZSBpcyBubyBuZWVkIHRvIHJlY3JlYXRlIGl0IGV2ZXJ5IHRpbWU6XG4gIHZhciBzdGVwTWVzc2FnZSA9IHsga2luZDogbWVzc2FnZUtpbmQuc3RlcCB9O1xuXG4gIHZhciBwb3NpdGlvbnMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gIHZhciBsYXlvdXRXb3JrZXIgPSB3b3JrKHJlcXVpcmUoJy4vbGliL2xheW91dFdvcmtlci5qcycpKTtcbiAgbGF5b3V0V29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBoYW5kbGVNZXNzYWdlRnJvbVdvcmtlcik7XG5cbiAgaW5pdFdvcmtlcigpO1xuICBpbml0UG9zaXRpb25zKCk7XG5cbiAgdmFyIGFwaSA9IHtcbiAgICAvKipcbiAgICAgKiBSZXF1ZXN0IHRvIHBlcmZvcm0gb25lIGl0ZXJhdGlvbiBvZiBmb3JjZSBsYXlvdXQuIFRoZSByZXF1ZXN0IGlzXG4gICAgICogZm9yd2FyZGVkIHRvIHdlYiB3b3JrZXJcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSB0cnVlIGlmIHN5c3RlbSBpcyBjb25zaWRlcmVkIHN0YWJsZTsgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIHN0ZXA6IGFzeW5jU3RlcCxcblxuICAgIC8qKlxuICAgICAqIEdldHMgdGhlIGxhc3Qga25vd24gcG9zaXRpb24gb2YgYSBnaXZlbiBub2RlIGJ5IGl0cyBpZGVudGlmaWVyLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG5vZGVJZCBpZGVudGlmaWVyIG9mIGEgbm9kZSBpbiBxdWVzdGlvbi5cbiAgICAgKiBAcmV0dXJucyB7b2JqZWN0fSB7eDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlcn0gY29vcmRpbmF0ZXMgb2YgYSBub2RlLlxuICAgICAqL1xuICAgIGdldE5vZGVQb3NpdGlvbjogZ2V0Tm9kZVBvc2l0aW9uLFxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0aGUgbGFzdCBrbm93biBwb3NpdGlvbiBvZiBhIGdpdmVuIGxpbmsgYnkgaXRzIGlkZW50aWZpZXIuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gbGlua0lkIGlkZW50aWZpZXIgb2YgYSBsaW5rIGluIHF1ZXN0aW9uLlxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IExpbmsgcG9zaXRpb24gYnkgbGluayBpZFxuICAgICAqIEByZXR1cm5zIHtPYmplY3QuZnJvbX0ge3gsIHl9IGNvb3JkaW5hdGVzIG9mIGxpbmsgc3RhcnRcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0LnRvfSB7eCwgeX0gY29vcmRpbmF0ZXMgb2YgbGluayBlbmRcbiAgICAgKi9cbiAgICBnZXRMaW5rUG9zaXRpb246IGdldExpbmtQb3NpdGlvbixcblxuICAgIC8qKlxuICAgICAqIFJlcXVlc3RzIGxheW91dCBhbGdvcml0aG0gdG8gcGluL3VucGluIG5vZGUgdG8gaXRzIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgKiBQaW5uZWQgbm9kZXMgc2hvdWxkIG5vdCBiZSBhZmZlY3RlZCBieSBsYXlvdXQgYWxnb3JpdGhtIGFuZCBhbHdheXNcbiAgICAgKiByZW1haW4gYXQgdGhlaXIgcG9zaXRpb25cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7b2JqZWN0fSBub2RlIGdyYXBoIG5vZGUgdGhhdCBuZWVkcyB0byBiZSBwaW5uZWRcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IGlzUGlubmVkIHN0YXR1cyBvZiB0aGUgbm9kZS5cbiAgICAgKi9cbiAgICBwaW5Ob2RlOiBhc3luY1Bpbk5vZGUsXG5cbiAgICAvKipcbiAgICAgKiBTZXRzIHBvc2l0aW9uIG9mIGEgbm9kZSB0byBhIGdpdmVuIGNvb3JkaW5hdGVzXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG5vZGVJZCBub2RlIGlkZW50aWZpZXJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geCBwb3NpdGlvbiBvZiBhIG5vZGVcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geSBwb3NpdGlvbiBvZiBhIG5vZGVcbiAgICAgKiBAcGFyYW0ge251bWJlcj19IHogcG9zaXRpb24gb2Ygbm9kZSAob25seSBpZiAzZCBsYXlvdXQpXG4gICAgICovXG4gICAgc2V0Tm9kZVBvc2l0aW9uOiBhc3luY05vZGVQb3NpdGlvbixcblxuICAgIC8qKlxuICAgICAqIEdldHMgcmVjdGFuZ2xlIChvciBhIGJveCkgdGhhdCBib3VuZHMgdGhlIGdyYXBoXG4gICAgICovXG4gICAgZ2V0R3JhcGhSZWN0OiBnZXRHcmFwaFJlY3QsXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRydWUgaWYgbm9kZSBpcyBjdXJyZW50bHkgcGlubmVkIChpLmUuIG5vdCBtb3ZlZCBieSBsYXlvdXQpO1xuICAgICAqIEZhbHNlIG90aGVyd2lzZS5cbiAgICAgKi9cbiAgICBpc05vZGVQaW5uZWQ6IGlzTm9kZVBpbm5lZFxuICB9O1xuXG4gIGV2ZW50aWZ5KGFwaSk7XG5cbiAgcmV0dXJuIGFwaTtcblxuICBmdW5jdGlvbiBhc3luY1N0ZXAoKSB7XG4gICAgLy8gd2UgY2Fubm90IGRvIGFueXRoaW5nIHVudGlsIHdlIHJlY2VpdmUgJ2luaXREb25lJyBtZXNzYWdlIGZyb20gd29ya2VyXG4gICAgLy8gdG8gY29uZmlybSB0aGF0IGl0J3MgcmVhZHkgdG8gcHJvY2VzcyBsYXlvdXQgcmVxdWVzdHMuXG4gICAgaWYgKHBlbmRpbmdJbml0aWFsaXphdGlvbikgcmV0dXJuO1xuXG4gICAgbGF5b3V0V29ya2VyLnBvc3RNZXNzYWdlKHN0ZXBNZXNzYWdlKTtcblxuICAgIC8vIFRPRE86IEkgbmVlZCB0byByZXdyaXRlIG5ncmFwaC5mb3JjZWxheW91dCB0byBiZSBldmVuLWRyaXZlbixcbiAgICAvLyBzbyB0aGF0IGl0IGNhbiBub3RpZnkgY2FsbGVyIGFib3V0IHN0YWJsZS91bnN0YWJsZSBjaGFuZ2UgYXN5bmNocm9ub3VzbHlcbiAgICByZXR1cm4gc3lzdGVtU3RhYmxlO1xuICB9XG5cbiAgZnVuY3Rpb24gYXN5bmNOb2RlUG9zaXRpb24obm9kZUlkLCB4LCB5LCB6KSB7XG4gICAgLy8gbGV0IGxheW91dCBrbm93IHRoYXQgd2UgY2hhbmdlZCB0aGUgcG9zaXRpb25cbiAgICBsYXlvdXRXb3JrZXIucG9zdE1lc3NhZ2Uoe1xuICAgICAga2luZDogbWVzc2FnZUtpbmQuc2V0Tm9kZVBvc2l0aW9uLFxuICAgICAgcGF5bG9hZDoge1xuICAgICAgICBub2RlSWQ6IG5vZGVJZCxcbiAgICAgICAgeDogeCxcbiAgICAgICAgeTogeSxcbiAgICAgICAgejogelxuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIGFsc28gdXBkYXRlIHN5bmNocm9ub3VzbHkgb3VyIGxhc3QgcmVtZW1iZXIgcG9zaXRpb246XG4gICAgYXNzaWduUG9zaXRpb24ocG9zaXRpb25zW25vZGVJZF0sIHsgeDogeCwgeTogeSwgejogeiB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldEdyYXBoUmVjdCgpIHtcbiAgICByZXR1cm4gZ3JhcGhSZWN0O1xuICB9XG5cbiAgZnVuY3Rpb24gYXN5bmNQaW5Ob2RlKG5vZGUsIGlzUGlubmVkKSB7XG4gICAgbGF5b3V0V29ya2VyLnBvc3RNZXNzYWdlKHtcbiAgICAgIGtpbmQ6IG1lc3NhZ2VLaW5kLnBpbk5vZGUsXG4gICAgICBwYXlsb2FkOiB7XG4gICAgICAgIG5vZGVJZDogbm9kZS5pZCxcbiAgICAgICAgaXNQaW5uZWQ6IGlzUGlubmVkXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyB3ZSBuZWVkIHRvIGhhdmUgc3luYyB3YXkgb2YgYW5zd2VyaW5nIHRvIGlzTm9kZVBpbm5lZCByZXF1ZXN0LlxuICAgIC8vIFRoaXMgaXMgbm90IHBlcmZlY3QsIHNpbmNlIG9yaWdpbmFsIGdyYXBoIGNvbmZpZ3VyYXRpb24gbWF5XG4gICAgLy8gaW5jbHVkZSBwaW5uZWQgbm9kZXMuIFdlIGN1cnJlbnRseSBkbyBub3QgdGFrZSB0aGF0IGludG8gYWNjb3VudC5cbiAgICBwaW5TdGF0dXNbbm9kZS5pZF0gPSBpc1Bpbm5lZDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzTm9kZVBpbm5lZChub2RlKSB7XG4gICAgcmV0dXJuIHBpblN0YXR1c1tub2RlLmlkXTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRXb3JrZXIoKSB7XG4gICAgaWYgKGluaXRSZXF1ZXN0U2VudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbml0IHJlcXVlc3QgaXMgYWxyZWFkeSBzZW50IHRvIHRoZSB3b3JrZXInKTtcbiAgICB9XG5cbiAgICBsYXlvdXRXb3JrZXIucG9zdE1lc3NhZ2Uoe1xuICAgICAga2luZDogbWVzc2FnZUtpbmQuaW5pdCxcbiAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgZ3JhcGg6IHRvanNvbihncmFwaCksXG4gICAgICAgIG9wdGlvbnM6IEpTT04uc3RyaW5naWZ5KG9wdGlvbnMpXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpbml0UmVxdWVzdFNlbnQgPSB0cnVlO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdFBvc2l0aW9ucygpIHtcbiAgICAvLyB3ZSBuZWVkIHRvIGluaXRpYWxpemUgcG9zaXRpb25zIGp1c3Qgb25jZVxuICAgIHZhciBsYXlvdXQgPSBjcmVhdGVMYXlvdXQoZ3JhcGgsIG9wdGlvbnMpO1xuICAgIGdyYXBoLmZvckVhY2hOb2RlKGluaXRQb3NpdGlvbik7XG4gICAgZ3JhcGhSZWN0ID0gbGF5b3V0LmdldEdyYXBoUmVjdCgpO1xuXG4gICAgZnVuY3Rpb24gaW5pdFBvc2l0aW9uKG5vZGUpIHtcbiAgICAgIHBvc2l0aW9uc1tub2RlLmlkXSA9IGxheW91dC5nZXROb2RlUG9zaXRpb24obm9kZS5pZCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZ2V0Tm9kZVBvc2l0aW9uKG5vZGVJZCkge1xuICAgIHJldHVybiBwb3NpdGlvbnNbbm9kZUlkXTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldExpbmtQb3NpdGlvbihsaW5rSWQpIHtcbiAgICBpZiAoIWxpbmtQb3NpdGlvbnMpIHtcbiAgICAgIGluaXRpYWxpemVMaW5rUG9zaXRpb25zKCk7XG4gICAgfVxuICAgIHJldHVybiBsaW5rUG9zaXRpb25zW2xpbmtJZF07XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplTGlua1Bvc2l0aW9ucygpIHtcbiAgICBsaW5rUG9zaXRpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICBncmFwaC5mb3JFYWNoTGluayhmdW5jdGlvbihsaW5rKSB7XG4gICAgICBsaW5rUG9zaXRpb25zW2xpbmsuaWRdID0ge1xuICAgICAgICBmcm9tOiBnZXROb2RlUG9zaXRpb24obGluay5mcm9tSWQpLFxuICAgICAgICB0bzogZ2V0Tm9kZVBvc2l0aW9uKGxpbmsudG9JZClcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVNZXNzYWdlRnJvbVdvcmtlcihtZXNzYWdlKSB7XG4gICAgdmFyIGtpbmQgPSBtZXNzYWdlLmRhdGEua2luZDtcbiAgICB2YXIgcGF5bG9hZCA9IG1lc3NhZ2UuZGF0YS5wYXlsb2FkXG5cbiAgICBpZiAoa2luZCA9PT0gbWVzc2FnZUtpbmQuY3ljbGVDb21wbGV0ZSkge1xuICAgICAgc2V0UG9zaXRpb25zKHBheWxvYWQucG9zaXRpb25zLCBwYXlsb2FkLnN5c3RlbVN0YWJsZSk7XG4gICAgICBncmFwaFJlY3QgPSBwYXlsb2FkLmJib3g7XG4gICAgICBhcGkuZmlyZSgnY3ljbGUnLCBwYXlsb2FkLml0ZXJhdGlvbnMsIHBheWxvYWQuc3lzdGVtU3RhYmxlKTtcbiAgICB9IGlmIChraW5kID09PSBtZXNzYWdlS2luZC5pbml0RG9uZSkge1xuICAgICAgcGVuZGluZ0luaXRpYWxpemF0aW9uID0gZmFsc2U7XG4gICAgICBhc3luY1N0ZXAoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzZXRQb3NpdGlvbnMobmV3UG9zaXRpb25zLCBuZXdTeXN0ZW1TdGFibGUpIHtcbiAgICBzeXN0ZW1TdGFibGUgPSBuZXdTeXN0ZW1TdGFibGU7XG4gICAgT2JqZWN0LmtleXMobmV3UG9zaXRpb25zKS5mb3JFYWNoKHVwZGF0ZVBvc2l0aW9uKTtcbiAgICByZXR1cm47XG5cbiAgICBmdW5jdGlvbiB1cGRhdGVQb3NpdGlvbihub2RlSWQpIHtcbiAgICAgIHZhciBuZXdQb3NpdGlvbiA9IG5ld1Bvc2l0aW9uc1tub2RlSWRdO1xuICAgICAgdmFyIG9sZFBvc2l0aW9uID0gcG9zaXRpb25zW25vZGVJZF07XG4gICAgICBpZiAoIW9sZFBvc2l0aW9uKSB7XG4gICAgICAgIHBvc2l0aW9uc1tub2RlSWRdID0gbmV3UG9zaXRpb247XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhc3NpZ25Qb3NpdGlvbihvbGRQb3NpdGlvbiwgbmV3UG9zaXRpb24pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhc3NpZ25Qb3NpdGlvbjNkKG9sZFBvcywgbmV3UG9zKSB7XG4gIG9sZFBvcy54ID0gbmV3UG9zLng7XG4gIG9sZFBvcy55ID0gbmV3UG9zLnk7XG4gIG9sZFBvcy56ID0gbmV3UG9zLno7XG59XG5cbmZ1bmN0aW9uIGFzc2lnblBvc2l0aW9uMmQob2xkUG9zLCBuZXdQb3MpIHtcbiAgb2xkUG9zLnggPSBuZXdQb3MueDtcbiAgb2xkUG9zLnkgPSBuZXdQb3MueTtcbn1cbiIsInZhciBsYXlvdXQzZCA9IHJlcXVpcmUoJ25ncmFwaC5mb3JjZWxheW91dDNkJyk7XG52YXIgbGF5b3V0MmQgPSBsYXlvdXQzZC5nZXQyZExheW91dDtcblxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVMYXlvdXQ7XG5cbmZ1bmN0aW9uIGNyZWF0ZUxheW91dChncmFwaCwgb3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICByZXR1cm4gb3B0aW9ucy5pczNkID9cbiAgICBsYXlvdXQzZChncmFwaCwgb3B0aW9ucy5waHlzaWNzKSA6XG4gICAgbGF5b3V0MmQoZ3JhcGgsIG9wdGlvbnMucGh5c2ljcyk7XG59XG4iLCJ2YXIgY3JlYXRlTGF5b3V0ID0gcmVxdWlyZSgnLi9jcmVhdGVMYXlvdXQuanMnKTtcbnZhciBmcm9tanNvbiA9IHJlcXVpcmUoJ25ncmFwaC5mcm9tanNvbicpO1xudmFyIHZhbGlkYXRlT3B0aW9ucyA9IHJlcXVpcmUoJy4uL29wdGlvbnMuanMnKTtcbnZhciBtZXNzYWdlS2luZCA9IHJlcXVpcmUoJy4vbWVzc2FnZXMuanMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBsYXlvdXRXb3JrZXI7XG5cbi8qKlxuICogVGhpcyBtZXRob2QgaXMgZXhlY3V0ZWQgYXMgYSB3ZWJ3b3JrZXIgdGhyZWFkLiBJdCBleHBlY3RzICdpbml0JyBzaWduYWxcbiAqIGZyb20gdGhlIG1haW4gdGhyZWFkIHRvIHN0YXJ0IGxheW91dC5cbiAqL1xuZnVuY3Rpb24gbGF5b3V0V29ya2VyKHNlbGYpIHtcbiAgdmFyIGxheW91dDsgLy8gbWFpbiB0aHJlYWQgd2lsbCBzZW5kIGEgbWVzc2FnZSB0byBpbml0aWFsaXplIHRoaXNcbiAgdmFyIGFzeW5jT3B0aW9ucztcbiAgdmFyIGNvbXBsZXRlZEl0ZXJhdGlvbnMgPSAwO1xuICB2YXIgc3RlcENhbGxlZCA9IGZhbHNlO1xuICB2YXIgdGltZW91dElkID0gMDtcbiAgdmFyIHN5c3RlbVN0YWJsZSA9IGZhbHNlO1xuICB2YXIgZ3JhcGg7XG5cbiAgdmFyIHBvc2l0aW9ucyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGhhbmRsZU1lc3NhZ2VGcm9tTWFpblRocmVhZCk7XG5cbiAgcmV0dXJuOyAvLyBwdWJsaWMgQVBJIGlzIG92ZXIuIEJlbG93IGFyZSBwcml2YXRlIG1ldGhvZHMgb25seS5cblxuICBmdW5jdGlvbiBoYW5kbGVNZXNzYWdlRnJvbU1haW5UaHJlYWQobWVzc2FnZSkge1xuICAgIHZhciBraW5kID0gbWVzc2FnZS5kYXRhLmtpbmQ7XG4gICAgdmFyIHBheWxvYWQgPSBtZXNzYWdlLmRhdGEucGF5bG9hZDtcblxuICAgIGlmIChraW5kID09PSBtZXNzYWdlS2luZC5pbml0KSB7XG4gICAgICBncmFwaCA9IGZyb21qc29uKHBheWxvYWQuZ3JhcGgpO1xuICAgICAgdmFyIG9wdGlvbnMgPSBKU09OLnBhcnNlKHBheWxvYWQub3B0aW9ucyk7XG5cbiAgICAgIGluaXQoZ3JhcGgsIG9wdGlvbnMpO1xuICAgIH0gZWxzZSBpZiAoa2luZCA9PT0gbWVzc2FnZUtpbmQuc3RlcCkge1xuICAgICAgc3RlcCgpO1xuICAgIH0gZWxzZSBpZiAoa2luZCA9PT0gbWVzc2FnZUtpbmQucGluTm9kZSkge1xuICAgICAgcGluTm9kZShwYXlsb2FkLm5vZGVJZCwgcGF5bG9hZC5pc1Bpbm5lZCk7XG4gICAgfSBlbHNlIGlmIChraW5kID09PSBtZXNzYWdlS2luZC5zZXROb2RlUG9zaXRpb24pIHtcbiAgICAgIHNldE5vZGVQb3NpdGlvbihwYXlsb2FkLm5vZGVJZCwgcGF5bG9hZC54LCBwYXlsb2FkLnksIHBheWxvYWQueik7XG4gICAgfVxuICAgIC8vIFRPRE86IGxpc3RlbiBmb3IgZ3JhcGggY2hhbmdlcyBmcm9tIG1haW4gdGhyZWFkIGFuZCB1cGRhdGUgbGF5b3V0IGhlcmUuXG4gIH1cblxuICBmdW5jdGlvbiBzZXROb2RlUG9zaXRpb24obm9kZUlkLCB4LCB5LCB6KSB7XG4gICAgYXNzZXJ0SW5pdGlhbGl6ZWQoKTtcblxuICAgIGxheW91dC5zZXROb2RlUG9zaXRpb24uYXBwbHkobGF5b3V0LCBhcmd1bWVudHMpO1xuICAgIHN5c3RlbVN0YWJsZSA9IGZhbHNlO1xuICAgIHN0ZXAoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHBpbk5vZGUobm9kZUlkLCBpc1Bpbm5lZCkge1xuICAgIGFzc2VydEluaXRpYWxpemVkKCk7XG5cbiAgICB2YXIgbm9kZSA9IGdyYXBoLmdldE5vZGUobm9kZUlkKTtcbiAgICBpZiAoIW5vZGUpIHJldHVybjsgLy8gaWdub3JpbmcgcmlnaHQgbm93LiBzaG91bGQgaXQgdGhyb3c/XG5cbiAgICBsYXlvdXQucGluTm9kZShub2RlLCBpc1Bpbm5lZCk7XG4gIH1cblxuICBmdW5jdGlvbiBhc3NlcnRJbml0aWFsaXplZCgpIHtcbiAgICBpZiAoIWdyYXBoKSB0aHJvdyBuZXcgRXJyb3IoJ1BpbiBub2RlIHJlcXVlc3RlZCB3aXRob3V0IGluaXRpYWxpZWQgZ3JhcGgnKTtcbiAgICBpZiAoIWxheW91dCkgdGhyb3cgbmV3IEVycm9yKCdMYXlvdXQgd2FzIG5vdCBjcmVhdGVkLiBTb21ldGhpbmcgaXMgcmVhbGx5IHdyb25nIGhlcmUnKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXQoZ3JhcGgsIG9wdGlvbnMpIHtcbiAgICAvLyB1bmZvcnR1bmF0ZWx5IHdlIG5lZWQgdG8gcmV2YWxpZGF0ZSBoZXJlLCBzaW5jZSBQT1NJVElWRV9JTkZJTklUWSBjb3VsZFxuICAgIC8vIGJlIGxvc3QgZHVyaW5nIHRocmVhZHMgdHJhbnNpdGlvblxuICAgIG9wdGlvbnMgPSB2YWxpZGF0ZU9wdGlvbnMob3B0aW9ucyk7XG4gICAgYXN5bmNPcHRpb25zID0gb3B0aW9ucy5hc3luYztcblxuICAgIGxheW91dCA9IGNyZWF0ZUxheW91dChncmFwaCwgb3B0aW9ucyk7XG4gICAgZ3JhcGguZm9yRWFjaE5vZGUoaW5pdFBvc2l0aW9uKTtcblxuICAgIC8vIGxldCBtYWluIHRocmVhZCBrbm93IHRoYXQgd2UgY2FuIHByb2Nlc3MgbGF5b3V0XG4gICAgc2VsZi5wb3N0TWVzc2FnZSh7IGtpbmQ6IG1lc3NhZ2VLaW5kLmluaXREb25lIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdFBvc2l0aW9uKG5vZGUpIHtcbiAgICBwb3NpdGlvbnNbbm9kZS5pZF0gPSBsYXlvdXQuZ2V0Tm9kZVBvc2l0aW9uKG5vZGUuaWQpO1xuICB9XG5cbiAgZnVuY3Rpb24gc3RlcCgpIHtcbiAgICBhc3NlcnRJbml0aWFsaXplZCgpO1xuXG4gICAgc3RlcENhbGxlZCA9IHRydWU7XG5cbiAgICBpZiAoIXRpbWVvdXRJZCkge1xuICAgICAgcnVuTGF5b3V0Q3ljbGVBc3luYygpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHJ1bkxheW91dEN5Y2xlQXN5bmMoKSB7XG4gICAgaWYgKHN5c3RlbVN0YWJsZSkge1xuICAgICAgdGltZW91dElkID0gMDtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyB3ZSBoYXZlIHRvIHVuYmxvY2sgdGhpcyB0aHJlYWQgdG8gcmVjZWl2ZSBtZXNzYWdlcyBmcm9tIHRoZSBtYWluIHRocmVhZC5cbiAgICB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgcnVuTGF5b3V0Q3ljbGUoKTtcblxuICAgICAgLy8gV2UgZWl0aGVyIHdhaXQgdW50aWwgbmV4dCBgc3RlcGAgZXZlbnQgZnJvbSBSQUYsIG9yIHJ1biBub3cgaWYgYXNrZWQgdG9cbiAgICAgIC8vIG5vdCB3YWl0IGZvciBgc3RlcGAuXG4gICAgICBpZiAoc3RlcENhbGxlZCB8fCAhYXN5bmNPcHRpb25zLndhaXRGb3JTdGVwKSB7XG4gICAgICAgIHN0ZXBDYWxsZWQgPSBmYWxzZTtcbiAgICAgICAgcnVuTGF5b3V0Q3ljbGVBc3luYygpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gd2FpdCBmb3IgdGhlIG5leHQgZXZlbnQgZnJvbSB0aGUgbWFpbiB0aHJlYWQgdG8gY29udGludWU7XG4gICAgICAgIHRpbWVvdXRJZCA9IDA7XG4gICAgICB9XG4gICAgfSwgMCk7XG4gIH1cblxuICBmdW5jdGlvbiBydW5MYXlvdXRDeWNsZSgpIHtcbiAgICB2YXIgd2FzU3RhYmxlID0gc3lzdGVtU3RhYmxlO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXN5bmNPcHRpb25zLnN0ZXBzUGVyQ3ljbGU7ICsraSkge1xuICAgICAgc3lzdGVtU3RhYmxlID0gbGF5b3V0LnN0ZXAoKTtcbiAgICAgIGNvbXBsZXRlZEl0ZXJhdGlvbnMgKz0gMTtcbiAgICB9XG5cbiAgICBpZiAoY29tcGxldGVkSXRlcmF0aW9ucyA+PSBhc3luY09wdGlvbnMubWF4SXRlcmF0aW9ucykge1xuICAgICAgc3lzdGVtU3RhYmxlID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBzZWxmLnBvc3RNZXNzYWdlKHtcbiAgICAgIGtpbmQ6IG1lc3NhZ2VLaW5kLmN5Y2xlQ29tcGxldGUsXG4gICAgICBwYXlsb2FkOiB7XG4gICAgICAgIHBvc2l0aW9uczogcG9zaXRpb25zLFxuICAgICAgICBzeXN0ZW1TdGFibGU6IHN5c3RlbVN0YWJsZSxcbiAgICAgICAgYmJveDogbGF5b3V0LmdldEdyYXBoUmVjdCgpLFxuICAgICAgICBpdGVyYXRpb25zOiBjb21wbGV0ZWRJdGVyYXRpb25zXG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn07XG4iLCIvKipcbiAqIFRoaXMgZmlsZSBkZWZpbmVzIGFsbCBwb3NzaWJsZSBtZXNzYWdlcyBiZXR3ZWVuIG1haW4gdGhyZWFkIGFuZFxuICogd2ViIHdvcmtlci4gVGhlIGtleSBpcyBodW1hbiByZWFkYWJsZSBtZXNzYWdlIHR5cGUsIGFuZCB0aGUgdmFsdWUgaXMgYVxuICogbnVtZXJpYyBhdHRyaWJ1dGUgZm9yIHF1aWNrIG1hdGNoaW5nXG4gKi9cbm1vZHVsZS5leHBvcnRzID0ge1xuICAvKipcbiAgICogU2VudCBmcm9tIG1haW4gdGhyZWFkIHRvIHdlYiB3b3JrZXIgdG8gaW5pdGlhbGl6ZSBmb3JjZSBsYXlvdXRcbiAgICpcbiAgICogcGF5bG9hZDpcbiAgICogIHtzdHJpbmd9IGdyYXBoIC0gcmVzdWx0IG9mIG5ncmFwaC50b2pzb24oZ3JhcGgpIG9wZXJhdGlvbi5cbiAgICogIHtzdHJpbmd9IG9wdGlvbnMgLSBzdHJpbmdpZmllZCBvcHRpbm9ucyByZWNlaXZlZCBieSBuZ3JhcGguYXN5bmNmb3JjZSgpLlxuICAgKi9cbiAgaW5pdDogMTAsXG5cbiAgLyoqXG4gICAqIFNlbnQgZnJvbSB3ZWIgd29ya2VyIHRvIG1haW4gdGhyZWFkIHRvIGNvbmZpcm0gdGhhdCB3b3JrZXIgaGFzIGRvbmVcbiAgICogaW5pdGlhbGl6YXRpbm8gYW5kIGNhbiBwcm9jZXNzIGluY29taW5nIGxheW91dCByZXF1ZXN0c1xuICAgKlxuICAgKiBwYXlsb2FkOiB1bmRlZmluZWQuXG4gICAqL1xuICBpbml0RG9uZTogMTEsXG5cbiAgLyoqXG4gICAqIFNlbnQgZnJvbSBtYWluIHRocmVhZCB0byB3ZWIgd29ya2VyIHRvIG5vdGlmeSB0aGF0IHJlbmRlcmluZyBsb29wIGlzIGN1cnJlbnRseVxuICAgKiBhY3RpdmUgYW5kIHdvcmtlciBzaG91bGQgcGVyZm9ybSBsYXlvdXQgKGlmIHJlcXVpcmVkKS4gV29ya2VyIGNhbiBkZWNpZGVcbiAgICogdG8gaWdub3JlIHRoaXMgcmVxdWVzdCBpZiwgZm9yIGV4YW1wbGUsIGxheW91dCBpcyBhbHJlYWR5IGNvbXB1dGVkLCBvclxuICAgKiB3b3JrZXIgaGFzIHBlcmZvcm1lZCBtb3JlIHRoYW4gb3B0aW9ucy5hc3luYy5tYXhJdGVyYXRpb25zIGl0ZXJhdGlvbnMuXG4gICAqXG4gICAqIHBheWxvYWQ6IHVuZGVmaW5lZC5cbiAgICovXG4gIHN0ZXA6IDEyLFxuXG4gIC8qKlxuICAgKiBTZW50IGZyb20gd2Vid29ya2VyIHRvIG1haW4gdGhyZWFkIHRvIGluZGljYXRlIHRoYXQgd29ya2VyIGhhcyBmaW5pc2hlZFxuICAgKiBvbmUgY3ljbGUgb2YgbGF5b3V0IGl0ZXJhdGlvbnMuIEVhY2ggY3ljbGUgY2FuIHBlcmZvcm0gdXAgdG9cbiAgICogb3B0aW9ucy5hc25jLnN0ZXBzUGVyQ3ljbGUgaXRlcmF0aW9ucyBvZiBsYXlvdXQuXG4gICAqXG4gICAqIHBheWxvYWQ6XG4gICAqICB7b2JqZWN0fSBwb3NpdGlvbnMgLSBrZXlzIGFyZSBub2RlIGlkcywgdmFsdWVzIGFyZSB7eCwgeSwgen0gY29vcmRpbmF0ZXNcbiAgICogIHtib29sZWFufSBzeXN0ZW1TdGFibGUgLSBpbmRpY2F0ZXMgdGhhdCBzeXN0ZW0gaXMgc3RhYmxlLiBOT1RFOiB0aGlzIHdpbGxcbiAgICogIGJlIHJlbW92ZWQgZnJvbSBmdXR1cmUgdmVyc2lvbi5cbiAgICovXG4gIGN5Y2xlQ29tcGxldGU6IDEzLFxuXG4gIC8qKlxuICAgKiBTZW50IGZyb20gbWFpbiB0aHJlYWQgdG8gd2ViIHdvcmtlciB0byBwaW4gbm9kZVxuICAgKlxuICAgKiBwYXlsb2FkOlxuICAgKiAgIHtzdHJpbmd9IG5vZGVJZCAtIGlkZW50aWZpZXIgb2YgdGhlIG5vZGUgdGhhdCBuZWVkcyB0byBiZSBwaW5uZWRcbiAgICogICB7Ym9vbGVhbn0gaXNQaW5uZWQgc3RhdHVzIG9mIHRoZSBub2RlXG4gICAqL1xuICBwaW5Ob2RlOiA0MSxcblxuICAvKipcbiAgICogU2VudCBmcm9tIG1haW4gdGhyZWFkIHRvIHdlYiB3b3JrZXIgdG8gc2V0IHBvc2l0aW9uIG9mIHRoZSBub2RlXG4gICAqXG4gICAqIHBheWxvYWQ6XG4gICAqICB7c3RyaW5nfSBub2RlSWQgLSBpZGVudGlmaWVyIG9mIHRoZSBub2RlIHRoYXQgbmVlZHMgcG9zaXRpb24gdXBkYXRlLlxuICAgKiAge251bWJlcn0geCAtIHggY29vcmRpbmF0ZVxuICAgKiAge251bWJlcn0geSAtIHkgY29vcmRpbmF0ZVxuICAgKiAge251bWJlcit9IHogLSB6IGNvb3JkaW5hdGUgLSBvbmx5IGFwcGxpY2FibGUgZm9yIDNkIGxheW91dFxuICAgKi9cbiAgc2V0Tm9kZVBvc2l0aW9uOiA0M1xufTtcbiIsIi8qKlxuICogVGhpcyBmaWxlIGRlZmluZXMgY29uZmlndXJhdGlvbiBvcHRpb25zIGZvciB0aGUgYXN5bmNmb3JjZSBtb2R1bGUuIEV2ZXJ5XG4gKiBjb25maWd1cmF0aW9uIGlzIG9wdGlvbmFsLiBZb3UgY2FuIGZpbmQgaXRzIGRlc2NyaXB0aW9uIGFuZCBkZWZhdWx0IHZhbHVlIGJlbG93LlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IHZhbGlkYXRlT3B0aW9ucztcblxuZnVuY3Rpb24gdmFsaWRhdGVPcHRpb25zKG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgLyoqXG4gICAqIERvIHdlIG5lZWQgdG8gcnVuIDNEIGxheW91dCBvciAyRD9cbiAgICovXG4gIG9wdGlvbnMuaXMzZCA9IHR5cGVvZiBvcHRpb25zLmlzM2QgPT09ICdib29sZWFuJyA/IG9wdGlvbnMuaXMzZCA6IGZhbHNlO1xuXG4gIC8vIFRoZXNlIG9wdGlvbnMgYXJlIGluIHNlcGFyYXRlIG9iamVjdCBzaW5jZSB0aGV5IGNvbmZpZ3VyZSB3ZWIgd29ya2VyIGJlaGF2aW9yXG4gIC8vIG5vdCBsYXlvdXQuXG4gIHZhciBhc3luYyA9IChvcHRpb25zLmFzeW5jID0gb3B0aW9ucy5hc3luYyB8fCB7fSk7XG5cbiAgLyoqXG4gICAqIFdlYiB3b3JrZXIgY29tcHV0ZXMgbGF5b3V0IGluIGN5Y2xlcy4gQWZ0ZXIgZWFjaCBjeWNsZSBpcyBkb25lIHdlYiB3b3JrZXJcbiAgICogbm90aWZpZXMgdGhlIG1haW4gdGhyZWFkIHdpdGggdXBkYXRlZCBwb3NpdGlvbnMuIFRoaXMgb3B0aW9ucyBkZWZpbmVzXG4gICAqIGhvdyBtYW55IGxheW91dCBzdGVwcyBzaG91bGQgd2ViIHdvcmtlciBjb21wbGV0ZSB3aXRoaW4gb25lIGN5Y2xlLlxuICAgKi9cbiAgYXN5bmMuc3RlcHNQZXJDeWNsZSA9IHR5cGVvZiBhc3luYy5zdGVwc1BlckN5Y2xlID09PSAnbnVtYmVyJyA/IGFzeW5jLnN0ZXBzUGVyQ3ljbGUgOiA1O1xuXG4gIC8qKlxuICAgKiBCeSBkZWZhdWx0IGxheW91dCB3aWxsIGJlIGNvbXB1dGVkIGFzIGxvbmcgYXMgZWFjaCBpdGVyYXRpb24gYnJpbmdzIHRvb1xuICAgKiBtdWNoIG1vdmVtZW50IHRvIHRoZSBzeXN0ZW0uIEhvd2V2ZXIgaWYgeW91J2QgbGlrZSB0byBjb21wdXRlIG9ubHkgTiBpdGVyYXRpb25zXG4gICAqIG9mIGxheW91dCwgeW91IGNhbiBzZXQgdGhpcyBvcHRpb24gdG8gTi4gT25jZSBsYXlvdXQgcmVhY2hlcyBOIGl0IHdpbGwgY29uc2lkZXJcbiAgICogc3lzdGVtIHN0YWJsZSBhbmQgd2lsbCBub3QgY29tcHV0ZSBtb3JlIGl0ZXJhdGlvbnMuXG4gICAqL1xuICBhc3luYy5tYXhJdGVyYXRpb25zID0gdHlwZW9mIGFzeW5jLm1heEl0ZXJhdGlvbnMgPT09ICdudW1iZXInID8gYXN5bmMubWF4SXRlcmF0aW9ucyA6IE51bWJlci5QT1NJVElWRV9JTkZJTklUWTtcblxuICAvKipcbiAgICogVW5saWtlIHJlcXVlc3RBbmltYXRpb25GcmFtZSgpIHdlYiB3b3JrZXJzIGFyZSBleGVjdXRlZCBldmVuIHdoZW4gcGFnZSBpc1xuICAgKiBub3QgYWN0aXZlIChlLmcuIHVzZXIgc3dpdGNoZWQgdG8gYSBkaWZmZXJlbnQgYnJvd3NlciB0YWIpLiBUaGlzIGNhbiByZXN1bHRcbiAgICogaW4gdW5uZWNlc3NhcnkgQ1BVIGNvbnN1bXB0aW9uIGFuZCBiYXR0ZXJ5IGRyYWluLlxuICAgKlxuICAgKiBCeSBkZWZhdWx0IGFzeW5jZm9yY2Ugd2lsbCBjYWxjdWxhdGUgbGF5b3V0IGFzIGxvbmcgYXMgeW91IGNhbGxcbiAgICogYGFzbmNmb3JjZS5zdGVwKClgLiBOb3JtYWxseSB5b3Ugd2lsbCBjYWxsIHRoaXMgbWV0aG9kIGZyb21cbiAgICogcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCkgaGFuZGxlciB0byBtYW5hZ2UgQ1BVIHJlc291cmNlcy5cbiAgICpcbiAgICogSG93ZXZlciwgaWYgeW91IHByZWZlciB0byBrZWVwIGNvbXB1dGluZyBsYXlvdXQgaW4gYmFja2dyb3VuZCBzZXQgdGhpc1xuICAgKiBvcHRpb25zIHRvIHRydWUuIExheW91dCB3aWxsIGJlIGNvbXB1dGVkIHVudGlsIHN5c3RlbSBpcyBjb25zaWRlcmVkIHN0YWJsZVxuICAgKiAoc2VlIGBtYXhJdGVyYXRpb25zYCBhYm92ZSkuXG4gICAqL1xuICBhc3luYy53YWl0Rm9yU3RlcCA9IHR5cGVvZiBhc3luYy53YWl0Rm9yU3RlcCA9PT0gJ2Jvb2xlYW4nID8gYXN5bmMud2FpdEZvclN0ZXAgOiB0cnVlO1xuICByZXR1cm4gb3B0aW9ucztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oc3ViamVjdCkge1xuICB2YWxpZGF0ZVN1YmplY3Qoc3ViamVjdCk7XG5cbiAgdmFyIGV2ZW50c1N0b3JhZ2UgPSBjcmVhdGVFdmVudHNTdG9yYWdlKHN1YmplY3QpO1xuICBzdWJqZWN0Lm9uID0gZXZlbnRzU3RvcmFnZS5vbjtcbiAgc3ViamVjdC5vZmYgPSBldmVudHNTdG9yYWdlLm9mZjtcbiAgc3ViamVjdC5maXJlID0gZXZlbnRzU3RvcmFnZS5maXJlO1xuICByZXR1cm4gc3ViamVjdDtcbn07XG5cbmZ1bmN0aW9uIGNyZWF0ZUV2ZW50c1N0b3JhZ2Uoc3ViamVjdCkge1xuICAvLyBTdG9yZSBhbGwgZXZlbnQgbGlzdGVuZXJzIHRvIHRoaXMgaGFzaC4gS2V5IGlzIGV2ZW50IG5hbWUsIHZhbHVlIGlzIGFycmF5XG4gIC8vIG9mIGNhbGxiYWNrIHJlY29yZHMuXG4gIC8vXG4gIC8vIEEgY2FsbGJhY2sgcmVjb3JkIGNvbnNpc3RzIG9mIGNhbGxiYWNrIGZ1bmN0aW9uIGFuZCBpdHMgb3B0aW9uYWwgY29udGV4dDpcbiAgLy8geyAnZXZlbnROYW1lJyA9PiBbe2NhbGxiYWNrOiBmdW5jdGlvbiwgY3R4OiBvYmplY3R9XSB9XG4gIHZhciByZWdpc3RlcmVkRXZlbnRzID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcblxuICByZXR1cm4ge1xuICAgIG9uOiBmdW5jdGlvbiAoZXZlbnROYW1lLCBjYWxsYmFjaywgY3R4KSB7XG4gICAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignY2FsbGJhY2sgaXMgZXhwZWN0ZWQgdG8gYmUgYSBmdW5jdGlvbicpO1xuICAgICAgfVxuICAgICAgdmFyIGhhbmRsZXJzID0gcmVnaXN0ZXJlZEV2ZW50c1tldmVudE5hbWVdO1xuICAgICAgaWYgKCFoYW5kbGVycykge1xuICAgICAgICBoYW5kbGVycyA9IHJlZ2lzdGVyZWRFdmVudHNbZXZlbnROYW1lXSA9IFtdO1xuICAgICAgfVxuICAgICAgaGFuZGxlcnMucHVzaCh7Y2FsbGJhY2s6IGNhbGxiYWNrLCBjdHg6IGN0eH0pO1xuXG4gICAgICByZXR1cm4gc3ViamVjdDtcbiAgICB9LFxuXG4gICAgb2ZmOiBmdW5jdGlvbiAoZXZlbnROYW1lLCBjYWxsYmFjaykge1xuICAgICAgdmFyIHdhbnRUb1JlbW92ZUFsbCA9ICh0eXBlb2YgZXZlbnROYW1lID09PSAndW5kZWZpbmVkJyk7XG4gICAgICBpZiAod2FudFRvUmVtb3ZlQWxsKSB7XG4gICAgICAgIC8vIEtpbGxpbmcgb2xkIGV2ZW50cyBzdG9yYWdlIHNob3VsZCBiZSBlbm91Z2ggaW4gdGhpcyBjYXNlOlxuICAgICAgICByZWdpc3RlcmVkRXZlbnRzID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICAgICAgcmV0dXJuIHN1YmplY3Q7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZWdpc3RlcmVkRXZlbnRzW2V2ZW50TmFtZV0pIHtcbiAgICAgICAgdmFyIGRlbGV0ZUFsbENhbGxiYWNrc0ZvckV2ZW50ID0gKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJyk7XG4gICAgICAgIGlmIChkZWxldGVBbGxDYWxsYmFja3NGb3JFdmVudCkge1xuICAgICAgICAgIGRlbGV0ZSByZWdpc3RlcmVkRXZlbnRzW2V2ZW50TmFtZV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIGNhbGxiYWNrcyA9IHJlZ2lzdGVyZWRFdmVudHNbZXZlbnROYW1lXTtcbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNhbGxiYWNrcy5sZW5ndGg7ICsraSkge1xuICAgICAgICAgICAgaWYgKGNhbGxiYWNrc1tpXS5jYWxsYmFjayA9PT0gY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgY2FsbGJhY2tzLnNwbGljZShpLCAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHN1YmplY3Q7XG4gICAgfSxcblxuICAgIGZpcmU6IGZ1bmN0aW9uIChldmVudE5hbWUpIHtcbiAgICAgIHZhciBjYWxsYmFja3MgPSByZWdpc3RlcmVkRXZlbnRzW2V2ZW50TmFtZV07XG4gICAgICBpZiAoIWNhbGxiYWNrcykge1xuICAgICAgICByZXR1cm4gc3ViamVjdDtcbiAgICAgIH1cblxuICAgICAgdmFyIGZpcmVBcmd1bWVudHM7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgZmlyZUFyZ3VtZW50cyA9IEFycmF5LnByb3RvdHlwZS5zcGxpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgfVxuICAgICAgZm9yKHZhciBpID0gMDsgaSA8IGNhbGxiYWNrcy5sZW5ndGg7ICsraSkge1xuICAgICAgICB2YXIgY2FsbGJhY2tJbmZvID0gY2FsbGJhY2tzW2ldO1xuICAgICAgICBjYWxsYmFja0luZm8uY2FsbGJhY2suYXBwbHkoY2FsbGJhY2tJbmZvLmN0eCwgZmlyZUFyZ3VtZW50cyk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBzdWJqZWN0O1xuICAgIH1cbiAgfTtcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVTdWJqZWN0KHN1YmplY3QpIHtcbiAgaWYgKCFzdWJqZWN0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdFdmVudGlmeSBjYW5ub3QgdXNlIGZhbHN5IG9iamVjdCBhcyBldmVudHMgc3ViamVjdCcpO1xuICB9XG4gIHZhciByZXNlcnZlZFdvcmRzID0gWydvbicsICdmaXJlJywgJ29mZiddO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHJlc2VydmVkV29yZHMubGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoc3ViamVjdC5oYXNPd25Qcm9wZXJ0eShyZXNlcnZlZFdvcmRzW2ldKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3ViamVjdCBjYW5ub3QgYmUgZXZlbnRpZmllZCwgc2luY2UgaXQgYWxyZWFkeSBoYXMgcHJvcGVydHkgJ1wiICsgcmVzZXJ2ZWRXb3Jkc1tpXSArIFwiJ1wiKTtcbiAgICB9XG4gIH1cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3NlUHJvcGVydGllcztcblxuLyoqXG4gKiBBdWdtZW50cyBgdGFyZ2V0YCBvYmplY3Qgd2l0aCBnZXR0ZXIvc2V0dGVyIGZ1bmN0aW9ucywgd2hpY2ggbW9kaWZ5IHNldHRpbmdzXG4gKlxuICogQGV4YW1wbGVcbiAqICB2YXIgdGFyZ2V0ID0ge307XG4gKiAgZXhwb3NlUHJvcGVydGllcyh7IGFnZTogNDJ9LCB0YXJnZXQpO1xuICogIHRhcmdldC5hZ2UoKTsgLy8gcmV0dXJucyA0MlxuICogIHRhcmdldC5hZ2UoMjQpOyAvLyBtYWtlIGFnZSAyNDtcbiAqXG4gKiAgdmFyIGZpbHRlcmVkVGFyZ2V0ID0ge307XG4gKiAgZXhwb3NlUHJvcGVydGllcyh7IGFnZTogNDIsIG5hbWU6ICdKb2huJ30sIGZpbHRlcmVkVGFyZ2V0LCBbJ25hbWUnXSk7XG4gKiAgZmlsdGVyZWRUYXJnZXQubmFtZSgpOyAvLyByZXR1cm5zICdKb2huJ1xuICogIGZpbHRlcmVkVGFyZ2V0LmFnZSA9PT0gdW5kZWZpbmVkOyAvLyB0cnVlXG4gKi9cbmZ1bmN0aW9uIGV4cG9zZVByb3BlcnRpZXMoc2V0dGluZ3MsIHRhcmdldCwgZmlsdGVyKSB7XG4gIHZhciBuZWVkc0ZpbHRlciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChmaWx0ZXIpID09PSAnW29iamVjdCBBcnJheV0nO1xuICBpZiAobmVlZHNGaWx0ZXIpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGZpbHRlci5sZW5ndGg7ICsraSkge1xuICAgICAgYXVnbWVudChzZXR0aW5ncywgdGFyZ2V0LCBmaWx0ZXJbaV0pO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gc2V0dGluZ3MpIHtcbiAgICAgIGF1Z21lbnQoc2V0dGluZ3MsIHRhcmdldCwga2V5KTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXVnbWVudChzb3VyY2UsIHRhcmdldCwga2V5KSB7XG4gIGlmIChzb3VyY2UuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgIGlmICh0eXBlb2YgdGFyZ2V0W2tleV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIHRoaXMgYWNjZXNzb3IgaXMgYWxyZWFkeSBkZWZpbmVkLiBJZ25vcmUgaXRcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGFyZ2V0W2tleV0gPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNvdXJjZVtrZXldID0gdmFsdWU7XG4gICAgICAgIHJldHVybiB0YXJnZXQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gc291cmNlW2tleV07XG4gICAgfVxuICB9XG59XG4iLCIvKipcbiAqIFRoaXMgbW9kdWxlIHByb3ZpZGVzIGFsbCByZXF1aXJlZCBmb3JjZXMgdG8gcmVndWxhciBuZ3JhcGgucGh5c2ljcy5zaW11bGF0b3JcbiAqIHRvIG1ha2UgaXQgM0Qgc2ltdWxhdG9yLiBJZGVhbGx5IG5ncmFwaC5waHlzaWNzLnNpbXVsYXRvciBzaG91bGQgb3BlcmF0ZVxuICogd2l0aCB2ZWN0b3JzLCBidXQgb24gcHJhY3RpY2VzIHRoYXQgc2hvd2VkIHBlcmZvcm1hbmNlIGRlY3JlYXNlLi4uIE1heWJlXG4gKiBJIHdhcyBkb2luZyBpdCB3cm9uZywgd2lsbCBzZWUgaWYgSSBjYW4gcmVmYWN0b3IvdGhyb3cgYXdheSB0aGlzIG1vZHVsZS5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGVMYXlvdXQ7XG5jcmVhdGVMYXlvdXQuZ2V0MmRMYXlvdXQgPSByZXF1aXJlKCduZ3JhcGguZm9yY2VsYXlvdXQnKTtcblxuZnVuY3Rpb24gY3JlYXRlTGF5b3V0KGdyYXBoLCBwaHlzaWNzU2V0dGluZ3MpIHtcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyk7XG4gIHBoeXNpY3NTZXR0aW5ncyA9IG1lcmdlKHBoeXNpY3NTZXR0aW5ncywge1xuICAgICAgICBjcmVhdGVRdWFkVHJlZTogcmVxdWlyZSgnbmdyYXBoLnF1YWR0cmVlYmgzZCcpLFxuICAgICAgICBjcmVhdGVCb3VuZHM6IHJlcXVpcmUoJy4vbGliL2JvdW5kcycpLFxuICAgICAgICBjcmVhdGVEcmFnRm9yY2U6IHJlcXVpcmUoJy4vbGliL2RyYWdGb3JjZScpLFxuICAgICAgICBjcmVhdGVTcHJpbmdGb3JjZTogcmVxdWlyZSgnLi9saWIvc3ByaW5nRm9yY2UnKSxcbiAgICAgICAgaW50ZWdyYXRvcjogcmVxdWlyZSgnLi9saWIvZXVsZXJJbnRlZ3JhdG9yJyksXG4gICAgICAgIGNyZWF0ZUJvZHk6IHJlcXVpcmUoJy4vbGliL2NyZWF0ZUJvZHknKVxuICAgICAgfSk7XG5cbiAgcmV0dXJuIGNyZWF0ZUxheW91dC5nZXQyZExheW91dChncmFwaCwgcGh5c2ljc1NldHRpbmdzKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGJvZGllcywgc2V0dGluZ3MpIHtcbiAgdmFyIHJhbmRvbSA9IHJlcXVpcmUoJ25ncmFwaC5yYW5kb20nKS5yYW5kb20oNDIpO1xuICB2YXIgYm91bmRpbmdCb3ggPSAgeyB4MTogMCwgeTE6IDAsIHoxOiAwLCB4MjogMCwgeTI6IDAsIHoyOiAwIH07XG5cbiAgcmV0dXJuIHtcbiAgICBib3g6IGJvdW5kaW5nQm94LFxuXG4gICAgdXBkYXRlOiB1cGRhdGVCb3VuZGluZ0JveCxcblxuICAgIHJlc2V0IDogZnVuY3Rpb24gKCkge1xuICAgICAgYm91bmRpbmdCb3gueDEgPSBib3VuZGluZ0JveC55MSA9IDA7XG4gICAgICBib3VuZGluZ0JveC54MiA9IGJvdW5kaW5nQm94LnkyID0gMDtcbiAgICAgIGJvdW5kaW5nQm94LnoxID0gYm91bmRpbmdCb3guejIgPSAwO1xuICAgIH0sXG5cbiAgICBnZXRCZXN0TmV3UG9zaXRpb246IGZ1bmN0aW9uIChuZWlnaGJvcnMpIHtcbiAgICAgIHZhciBncmFwaFJlY3QgPSBib3VuZGluZ0JveDtcblxuICAgICAgdmFyIGJhc2VYID0gMCwgYmFzZVkgPSAwLCBiYXNlWiA9IDA7XG5cbiAgICAgIGlmIChuZWlnaGJvcnMubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmVpZ2hib3JzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgYmFzZVggKz0gbmVpZ2hib3JzW2ldLnBvcy54O1xuICAgICAgICAgIGJhc2VZICs9IG5laWdoYm9yc1tpXS5wb3MueTtcbiAgICAgICAgICBiYXNlWiArPSBuZWlnaGJvcnNbaV0ucG9zLno7XG4gICAgICAgIH1cblxuICAgICAgICBiYXNlWCAvPSBuZWlnaGJvcnMubGVuZ3RoO1xuICAgICAgICBiYXNlWSAvPSBuZWlnaGJvcnMubGVuZ3RoO1xuICAgICAgICBiYXNlWiAvPSBuZWlnaGJvcnMubGVuZ3RoO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYmFzZVggPSAoZ3JhcGhSZWN0LngxICsgZ3JhcGhSZWN0LngyKSAvIDI7XG4gICAgICAgIGJhc2VZID0gKGdyYXBoUmVjdC55MSArIGdyYXBoUmVjdC55MikgLyAyO1xuICAgICAgICBiYXNlWiA9IChncmFwaFJlY3QuejEgKyBncmFwaFJlY3QuejIpIC8gMjtcbiAgICAgIH1cblxuICAgICAgdmFyIHNwcmluZ0xlbmd0aCA9IHNldHRpbmdzLnNwcmluZ0xlbmd0aDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHg6IGJhc2VYICsgcmFuZG9tLm5leHQoc3ByaW5nTGVuZ3RoKSAtIHNwcmluZ0xlbmd0aCAvIDIsXG4gICAgICAgIHk6IGJhc2VZICsgcmFuZG9tLm5leHQoc3ByaW5nTGVuZ3RoKSAtIHNwcmluZ0xlbmd0aCAvIDIsXG4gICAgICAgIHo6IGJhc2VaICsgcmFuZG9tLm5leHQoc3ByaW5nTGVuZ3RoKSAtIHNwcmluZ0xlbmd0aCAvIDJcbiAgICAgIH07XG4gICAgfVxuICB9O1xuXG4gIGZ1bmN0aW9uIHVwZGF0ZUJvdW5kaW5nQm94KCkge1xuICAgIHZhciBpID0gYm9kaWVzLmxlbmd0aDtcbiAgICBpZiAoaSA9PT0gMCkgeyByZXR1cm47IH0gLy8gZG9uJ3QgaGF2ZSB0byB3b3J5IGhlcmUuXG5cbiAgICB2YXIgeDEgPSBOdW1iZXIuTUFYX1ZBTFVFLFxuICAgICAgICB5MSA9IE51bWJlci5NQVhfVkFMVUUsXG4gICAgICAgIHoxID0gTnVtYmVyLk1BWF9WQUxVRSxcbiAgICAgICAgeDIgPSBOdW1iZXIuTUlOX1ZBTFVFLFxuICAgICAgICB5MiA9IE51bWJlci5NSU5fVkFMVUUsXG4gICAgICAgIHoyID0gTnVtYmVyLk1JTl9WQUxVRTtcblxuICAgIHdoaWxlKGktLSkge1xuICAgICAgLy8gdGhpcyBpcyBPKG4pLCBjb3VsZCBpdCBiZSBkb25lIGZhc3RlciB3aXRoIHF1YWR0cmVlP1xuICAgICAgLy8gaG93IGFib3V0IHBpbm5lZCBub2Rlcz9cbiAgICAgIHZhciBib2R5ID0gYm9kaWVzW2ldO1xuICAgICAgaWYgKGJvZHkuaXNQaW5uZWQpIHtcbiAgICAgICAgYm9keS5wb3MueCA9IGJvZHkucHJldlBvcy54O1xuICAgICAgICBib2R5LnBvcy55ID0gYm9keS5wcmV2UG9zLnk7XG4gICAgICAgIGJvZHkucG9zLnogPSBib2R5LnByZXZQb3MuejtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJvZHkucHJldlBvcy54ID0gYm9keS5wb3MueDtcbiAgICAgICAgYm9keS5wcmV2UG9zLnkgPSBib2R5LnBvcy55O1xuICAgICAgICBib2R5LnByZXZQb3MueiA9IGJvZHkucG9zLno7XG4gICAgICB9XG4gICAgICBpZiAoYm9keS5wb3MueCA8IHgxKSB7XG4gICAgICAgIHgxID0gYm9keS5wb3MueDtcbiAgICAgIH1cbiAgICAgIGlmIChib2R5LnBvcy54ID4geDIpIHtcbiAgICAgICAgeDIgPSBib2R5LnBvcy54O1xuICAgICAgfVxuICAgICAgaWYgKGJvZHkucG9zLnkgPCB5MSkge1xuICAgICAgICB5MSA9IGJvZHkucG9zLnk7XG4gICAgICB9XG4gICAgICBpZiAoYm9keS5wb3MueSA+IHkyKSB7XG4gICAgICAgIHkyID0gYm9keS5wb3MueTtcbiAgICAgIH1cbiAgICAgIGlmIChib2R5LnBvcy56IDwgejEpIHtcbiAgICAgICAgejEgPSBib2R5LnBvcy56O1xuICAgICAgfVxuICAgICAgaWYgKGJvZHkucG9zLnogPiB6Mikge1xuICAgICAgICB6MiA9IGJvZHkucG9zLno7XG4gICAgICB9XG4gICAgfVxuXG4gICAgYm91bmRpbmdCb3gueDEgPSB4MTtcbiAgICBib3VuZGluZ0JveC54MiA9IHgyO1xuICAgIGJvdW5kaW5nQm94LnkxID0geTE7XG4gICAgYm91bmRpbmdCb3gueTIgPSB5MjtcbiAgICBib3VuZGluZ0JveC56MSA9IHoxO1xuICAgIGJvdW5kaW5nQm94LnoyID0gejI7XG4gIH1cbn07XG4iLCJ2YXIgcGh5c2ljcyA9IHJlcXVpcmUoJ25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIG5ldyBwaHlzaWNzLkJvZHkzZChwb3MpO1xufVxuIiwiLyoqXG4gKiBSZXByZXNlbnRzIDNkIGRyYWcgZm9yY2UsIHdoaWNoIHJlZHVjZXMgZm9yY2UgdmFsdWUgb24gZWFjaCBzdGVwIGJ5IGdpdmVuXG4gKiBjb2VmZmljaWVudC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBmb3IgdGhlIGRyYWcgZm9yY2VcbiAqIEBwYXJhbSB7TnVtYmVyPX0gb3B0aW9ucy5kcmFnQ29lZmYgZHJhZyBmb3JjZSBjb2VmZmljaWVudC4gMC4xIGJ5IGRlZmF1bHRcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgbWVyZ2UgPSByZXF1aXJlKCduZ3JhcGgubWVyZ2UnKSxcbiAgICAgIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcblxuICBvcHRpb25zID0gbWVyZ2Uob3B0aW9ucywge1xuICAgIGRyYWdDb2VmZjogMC4wMlxuICB9KTtcblxuICB2YXIgYXBpID0ge1xuICAgIHVwZGF0ZSA6IGZ1bmN0aW9uIChib2R5KSB7XG4gICAgICBib2R5LmZvcmNlLnggLT0gb3B0aW9ucy5kcmFnQ29lZmYgKiBib2R5LnZlbG9jaXR5Lng7XG4gICAgICBib2R5LmZvcmNlLnkgLT0gb3B0aW9ucy5kcmFnQ29lZmYgKiBib2R5LnZlbG9jaXR5Lnk7XG4gICAgICBib2R5LmZvcmNlLnogLT0gb3B0aW9ucy5kcmFnQ29lZmYgKiBib2R5LnZlbG9jaXR5Lno7XG4gICAgfVxuICB9O1xuXG4gIC8vIGxldCBlYXN5IGFjY2VzcyB0byBkcmFnQ29lZmY6XG4gIGV4cG9zZShvcHRpb25zLCBhcGksIFsnZHJhZ0NvZWZmJ10pO1xuXG4gIHJldHVybiBhcGk7XG59O1xuIiwiLyoqXG4gKiBQZXJmb3JtcyAzZCBmb3JjZXMgaW50ZWdyYXRpb24sIHVzaW5nIGdpdmVuIHRpbWVzdGVwLiBVc2VzIEV1bGVyIG1ldGhvZCB0byBzb2x2ZVxuICogZGlmZmVyZW50aWFsIGVxdWF0aW9uIChodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0V1bGVyX21ldGhvZCApLlxuICpcbiAqIEByZXR1cm5zIHtOdW1iZXJ9IHNxdWFyZWQgZGlzdGFuY2Ugb2YgdG90YWwgcG9zaXRpb24gdXBkYXRlcy5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGludGVncmF0ZTtcblxuZnVuY3Rpb24gaW50ZWdyYXRlKGJvZGllcywgdGltZVN0ZXApIHtcbiAgdmFyIGR4ID0gMCwgdHggPSAwLFxuICAgICAgZHkgPSAwLCB0eSA9IDAsXG4gICAgICBkeiA9IDAsIHR6ID0gMCxcbiAgICAgIGksXG4gICAgICBtYXggPSBib2RpZXMubGVuZ3RoO1xuXG4gIGZvciAoaSA9IDA7IGkgPCBtYXg7ICsraSkge1xuICAgIHZhciBib2R5ID0gYm9kaWVzW2ldLFxuICAgICAgICBjb2VmZiA9IHRpbWVTdGVwIC8gYm9keS5tYXNzO1xuXG4gICAgYm9keS52ZWxvY2l0eS54ICs9IGNvZWZmICogYm9keS5mb3JjZS54O1xuICAgIGJvZHkudmVsb2NpdHkueSArPSBjb2VmZiAqIGJvZHkuZm9yY2UueTtcbiAgICBib2R5LnZlbG9jaXR5LnogKz0gY29lZmYgKiBib2R5LmZvcmNlLno7XG5cbiAgICB2YXIgdnggPSBib2R5LnZlbG9jaXR5LngsXG4gICAgICAgIHZ5ID0gYm9keS52ZWxvY2l0eS55LFxuICAgICAgICB2eiA9IGJvZHkudmVsb2NpdHkueixcbiAgICAgICAgdiA9IE1hdGguc3FydCh2eCAqIHZ4ICsgdnkgKiB2eSArIHZ6ICogdnopO1xuXG4gICAgaWYgKHYgPiAxKSB7XG4gICAgICBib2R5LnZlbG9jaXR5LnggPSB2eCAvIHY7XG4gICAgICBib2R5LnZlbG9jaXR5LnkgPSB2eSAvIHY7XG4gICAgICBib2R5LnZlbG9jaXR5LnogPSB2eiAvIHY7XG4gICAgfVxuXG4gICAgZHggPSB0aW1lU3RlcCAqIGJvZHkudmVsb2NpdHkueDtcbiAgICBkeSA9IHRpbWVTdGVwICogYm9keS52ZWxvY2l0eS55O1xuICAgIGR6ID0gdGltZVN0ZXAgKiBib2R5LnZlbG9jaXR5Lno7XG5cbiAgICBib2R5LnBvcy54ICs9IGR4O1xuICAgIGJvZHkucG9zLnkgKz0gZHk7XG4gICAgYm9keS5wb3MueiArPSBkejtcblxuICAgIHR4ICs9IE1hdGguYWJzKGR4KTsgdHkgKz0gTWF0aC5hYnMoZHkpOyB0eiArPSBNYXRoLmFicyhkeik7XG4gIH1cblxuICByZXR1cm4gKHR4ICogdHggKyB0eSAqIHR5ICsgdHogKiB0eikvYm9kaWVzLmxlbmd0aDtcbn1cbiIsIi8qKlxuICogUmVwcmVzZW50cyAzZCBzcHJpbmcgZm9yY2UsIHdoaWNoIHVwZGF0ZXMgZm9yY2VzIGFjdGluZyBvbiB0d28gYm9kaWVzLCBjb25udGVjdGVkXG4gKiBieSBhIHNwcmluZy5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBmb3IgdGhlIHNwcmluZyBmb3JjZVxuICogQHBhcmFtIHtOdW1iZXI9fSBvcHRpb25zLnNwcmluZ0NvZWZmIHNwcmluZyBmb3JjZSBjb2VmZmljaWVudC5cbiAqIEBwYXJhbSB7TnVtYmVyPX0gb3B0aW9ucy5zcHJpbmdMZW5ndGggZGVzaXJlZCBsZW5ndGggb2YgYSBzcHJpbmcgYXQgcmVzdC5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgbWVyZ2UgPSByZXF1aXJlKCduZ3JhcGgubWVyZ2UnKTtcbiAgdmFyIHJhbmRvbSA9IHJlcXVpcmUoJ25ncmFwaC5yYW5kb20nKS5yYW5kb20oNDIpO1xuICB2YXIgZXhwb3NlID0gcmVxdWlyZSgnbmdyYXBoLmV4cG9zZScpO1xuXG4gIG9wdGlvbnMgPSBtZXJnZShvcHRpb25zLCB7XG4gICAgc3ByaW5nQ29lZmY6IDAuMDAwMixcbiAgICBzcHJpbmdMZW5ndGg6IDgwXG4gIH0pO1xuXG4gIHZhciBhcGkgPSB7XG4gICAgLyoqXG4gICAgICogVXBzYXRlcyBmb3JjZXMgYWN0aW5nIG9uIGEgc3ByaW5nXG4gICAgICovXG4gICAgdXBkYXRlIDogZnVuY3Rpb24gKHNwcmluZykge1xuICAgICAgdmFyIGJvZHkxID0gc3ByaW5nLmZyb20sXG4gICAgICAgICAgYm9keTIgPSBzcHJpbmcudG8sXG4gICAgICAgICAgbGVuZ3RoID0gc3ByaW5nLmxlbmd0aCA8IDAgPyBvcHRpb25zLnNwcmluZ0xlbmd0aCA6IHNwcmluZy5sZW5ndGgsXG4gICAgICAgICAgZHggPSBib2R5Mi5wb3MueCAtIGJvZHkxLnBvcy54LFxuICAgICAgICAgIGR5ID0gYm9keTIucG9zLnkgLSBib2R5MS5wb3MueSxcbiAgICAgICAgICBkeiA9IGJvZHkyLnBvcy56IC0gYm9keTEucG9zLnosXG4gICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSArIGR6ICogZHopO1xuXG4gICAgICBpZiAociA9PT0gMCkge1xuICAgICAgICAgIGR4ID0gKHJhbmRvbS5uZXh0RG91YmxlKCkgLSAwLjUpIC8gNTA7XG4gICAgICAgICAgZHkgPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICBkeiA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkgKyBkeiAqIGR6KTtcbiAgICAgIH1cblxuICAgICAgdmFyIGQgPSByIC0gbGVuZ3RoO1xuICAgICAgdmFyIGNvZWZmID0gKCghc3ByaW5nLmNvZWZmIHx8IHNwcmluZy5jb2VmZiA8IDApID8gb3B0aW9ucy5zcHJpbmdDb2VmZiA6IHNwcmluZy5jb2VmZikgKiBkIC8gciAqIHNwcmluZy53ZWlnaHQ7XG5cbiAgICAgIGJvZHkxLmZvcmNlLnggKz0gY29lZmYgKiBkeDtcbiAgICAgIGJvZHkxLmZvcmNlLnkgKz0gY29lZmYgKiBkeTtcbiAgICAgIGJvZHkxLmZvcmNlLnogKz0gY29lZmYgKiBkejtcblxuICAgICAgYm9keTIuZm9yY2UueCAtPSBjb2VmZiAqIGR4O1xuICAgICAgYm9keTIuZm9yY2UueSAtPSBjb2VmZiAqIGR5O1xuICAgICAgYm9keTIuZm9yY2UueiAtPSBjb2VmZiAqIGR6O1xuICAgIH1cbiAgfTtcblxuICBleHBvc2Uob3B0aW9ucywgYXBpLCBbJ3NwcmluZ0NvZWZmJywgJ3NwcmluZ0xlbmd0aCddKTtcbiAgcmV0dXJuIGFwaTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gY3JlYXRlTGF5b3V0O1xubW9kdWxlLmV4cG9ydHMuc2ltdWxhdG9yID0gcmVxdWlyZSgnbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yJyk7XG5cbi8qKlxuICogQ3JlYXRlcyBmb3JjZSBiYXNlZCBsYXlvdXQgZm9yIGEgZ2l2ZW4gZ3JhcGguXG4gKiBAcGFyYW0ge25ncmFwaC5ncmFwaH0gZ3JhcGggd2hpY2ggbmVlZHMgdG8gYmUgbGFpZCBvdXRcbiAqIEBwYXJhbSB7b2JqZWN0fSBwaHlzaWNzU2V0dGluZ3MgaWYgeW91IG5lZWQgY3VzdG9tIHNldHRpbmdzXG4gKiBmb3IgcGh5c2ljcyBzaW11bGF0b3IgeW91IGNhbiBwYXNzIHlvdXIgb3duIHNldHRpbmdzIGhlcmUuIElmIGl0J3Mgbm90IHBhc3NlZFxuICogYSBkZWZhdWx0IG9uZSB3aWxsIGJlIGNyZWF0ZWQuXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUxheW91dChncmFwaCwgcGh5c2ljc1NldHRpbmdzKSB7XG4gIGlmICghZ3JhcGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0dyYXBoIHN0cnVjdHVyZSBjYW5ub3QgYmUgdW5kZWZpbmVkJyk7XG4gIH1cblxuICB2YXIgY3JlYXRlU2ltdWxhdG9yID0gcmVxdWlyZSgnbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yJyk7XG4gIHZhciBwaHlzaWNzU2ltdWxhdG9yID0gY3JlYXRlU2ltdWxhdG9yKHBoeXNpY3NTZXR0aW5ncyk7XG5cbiAgdmFyIG5vZGVCb2RpZXMgPSB0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJyA/IE9iamVjdC5jcmVhdGUobnVsbCkgOiB7fTtcbiAgdmFyIHNwcmluZ3MgPSB7fTtcblxuICB2YXIgc3ByaW5nVHJhbnNmb3JtID0gcGh5c2ljc1NpbXVsYXRvci5zZXR0aW5ncy5zcHJpbmdUcmFuc2Zvcm0gfHwgbm9vcDtcblxuICAvLyBJbml0aWFsaXplIHBoeXNpY2FsIG9iamVjdHMgYWNjb3JkaW5nIHRvIHdoYXQgd2UgaGF2ZSBpbiB0aGUgZ3JhcGg6XG4gIGluaXRQaHlzaWNzKCk7XG4gIGxpc3RlblRvR3JhcGhFdmVudHMoKTtcblxuICB2YXIgYXBpID0ge1xuICAgIC8qKlxuICAgICAqIFBlcmZvcm1zIG9uZSBzdGVwIG9mIGl0ZXJhdGl2ZSBsYXlvdXQgYWxnb3JpdGhtXG4gICAgICovXG4gICAgc3RlcDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gcGh5c2ljc1NpbXVsYXRvci5zdGVwKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEZvciBhIGdpdmVuIGBub2RlSWRgIHJldHVybnMgcG9zaXRpb25cbiAgICAgKi9cbiAgICBnZXROb2RlUG9zaXRpb246IGZ1bmN0aW9uIChub2RlSWQpIHtcbiAgICAgIHJldHVybiBnZXRJbml0aWFsaXplZEJvZHkobm9kZUlkKS5wb3M7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFNldHMgcG9zaXRpb24gb2YgYSBub2RlIHRvIGEgZ2l2ZW4gY29vcmRpbmF0ZXNcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gbm9kZUlkIG5vZGUgaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSB4IHBvc2l0aW9uIG9mIGEgbm9kZVxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSB5IHBvc2l0aW9uIG9mIGEgbm9kZVxuICAgICAqIEBwYXJhbSB7bnVtYmVyPX0geiBwb3NpdGlvbiBvZiBub2RlIChvbmx5IGlmIGFwcGxpY2FibGUgdG8gYm9keSlcbiAgICAgKi9cbiAgICBzZXROb2RlUG9zaXRpb246IGZ1bmN0aW9uIChub2RlSWQpIHtcbiAgICAgIHZhciBib2R5ID0gZ2V0SW5pdGlhbGl6ZWRCb2R5KG5vZGVJZCk7XG4gICAgICBib2R5LnNldFBvc2l0aW9uLmFwcGx5KGJvZHksIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSkpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBMaW5rIHBvc2l0aW9uIGJ5IGxpbmsgaWRcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0LmZyb219IHt4LCB5fSBjb29yZGluYXRlcyBvZiBsaW5rIHN0YXJ0XG4gICAgICogQHJldHVybnMge09iamVjdC50b30ge3gsIHl9IGNvb3JkaW5hdGVzIG9mIGxpbmsgZW5kXG4gICAgICovXG4gICAgZ2V0TGlua1Bvc2l0aW9uOiBmdW5jdGlvbiAobGlua0lkKSB7XG4gICAgICB2YXIgc3ByaW5nID0gc3ByaW5nc1tsaW5rSWRdO1xuICAgICAgaWYgKHNwcmluZykge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGZyb206IHNwcmluZy5mcm9tLnBvcyxcbiAgICAgICAgICB0bzogc3ByaW5nLnRvLnBvc1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBhcmVhIHJlcXVpcmVkIHRvIGZpdCBpbiB0aGUgZ3JhcGguIE9iamVjdCBjb250YWluc1xuICAgICAqIGB4MWAsIGB5MWAgLSB0b3AgbGVmdCBjb29yZGluYXRlc1xuICAgICAqIGB4MmAsIGB5MmAgLSBib3R0b20gcmlnaHQgY29vcmRpbmF0ZXNcbiAgICAgKi9cbiAgICBnZXRHcmFwaFJlY3Q6IGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiBwaHlzaWNzU2ltdWxhdG9yLmdldEJCb3goKTtcbiAgICB9LFxuXG4gICAgLypcbiAgICAgKiBSZXF1ZXN0cyBsYXlvdXQgYWxnb3JpdGhtIHRvIHBpbi91bnBpbiBub2RlIHRvIGl0cyBjdXJyZW50IHBvc2l0aW9uXG4gICAgICogUGlubmVkIG5vZGVzIHNob3VsZCBub3QgYmUgYWZmZWN0ZWQgYnkgbGF5b3V0IGFsZ29yaXRobSBhbmQgYWx3YXlzXG4gICAgICogcmVtYWluIGF0IHRoZWlyIHBvc2l0aW9uXG4gICAgICovXG4gICAgcGluTm9kZTogZnVuY3Rpb24gKG5vZGUsIGlzUGlubmVkKSB7XG4gICAgICB2YXIgYm9keSA9IGdldEluaXRpYWxpemVkQm9keShub2RlLmlkKTtcbiAgICAgICBib2R5LmlzUGlubmVkID0gISFpc1Bpbm5lZDtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogQ2hlY2tzIHdoZXRoZXIgZ2l2ZW4gZ3JhcGgncyBub2RlIGlzIGN1cnJlbnRseSBwaW5uZWRcbiAgICAgKi9cbiAgICBpc05vZGVQaW5uZWQ6IGZ1bmN0aW9uIChub2RlKSB7XG4gICAgICByZXR1cm4gZ2V0SW5pdGlhbGl6ZWRCb2R5KG5vZGUuaWQpLmlzUGlubmVkO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXF1ZXN0IHRvIHJlbGVhc2UgYWxsIHJlc291cmNlc1xuICAgICAqL1xuICAgIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgICAgZ3JhcGgub2ZmKCdjaGFuZ2VkJywgb25HcmFwaENoYW5nZWQpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBHZXRzIHBoeXNpY2FsIGJvZHkgZm9yIGEgZ2l2ZW4gbm9kZSBpZC4gSWYgbm9kZSBpcyBub3QgZm91bmQgdW5kZWZpbmVkXG4gICAgICogdmFsdWUgaXMgcmV0dXJuZWQuXG4gICAgICovXG4gICAgZ2V0Qm9keTogZ2V0Qm9keSxcblxuICAgIC8qKlxuICAgICAqIEdldHMgc3ByaW5nIGZvciBhIGdpdmVuIGVkZ2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gbGlua0lkIGxpbmsgaWRlbnRpZmVyLiBJZiB0d28gYXJndW1lbnRzIGFyZSBwYXNzZWQgdGhlblxuICAgICAqIHRoaXMgYXJndW1lbnQgaXMgdHJlYXRlZCBhcyBmb3JtTm9kZUlkXG4gICAgICogQHBhcmFtIHtzdHJpbmc9fSB0b0lkIHdoZW4gZGVmaW5lZCB0aGlzIHBhcmFtZXRlciBkZW5vdGVzIGhlYWQgb2YgdGhlIGxpbmtcbiAgICAgKiBhbmQgZmlyc3QgYXJndW1lbnQgaXMgdHJhdGVkIGFzIHRhaWwgb2YgdGhlIGxpbmsgKGZyb21JZClcbiAgICAgKi9cbiAgICBnZXRTcHJpbmc6IGdldFNwcmluZyxcblxuICAgIC8qKlxuICAgICAqIFtSZWFkIG9ubHldIEdldHMgY3VycmVudCBwaHlzaWNzIHNpbXVsYXRvclxuICAgICAqL1xuICAgIHNpbXVsYXRvcjogcGh5c2ljc1NpbXVsYXRvclxuICB9O1xuXG4gIHJldHVybiBhcGk7XG5cbiAgZnVuY3Rpb24gZ2V0U3ByaW5nKGZyb21JZCwgdG9JZCkge1xuICAgIHZhciBsaW5rSWQ7XG4gICAgaWYgKHRvSWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKHR5cGVvZiBmcm9tSWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIGFzc3VtZSBmcm9tSWQgYXMgYSBsaW5rSWQ6XG4gICAgICAgIGxpbmtJZCA9IGZyb21JZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIGFzc3VtZSBmcm9tSWQgdG8gYmUgYSBsaW5rIG9iamVjdDpcbiAgICAgICAgbGlua0lkID0gZnJvbUlkLmlkO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyB0b0lkIGlzIGRlZmluZWQsIHNob3VsZCBncmFiIGxpbms6XG4gICAgICB2YXIgbGluayA9IGdyYXBoLmhhc0xpbmsoZnJvbUlkLCB0b0lkKTtcbiAgICAgIGlmICghbGluaykgcmV0dXJuO1xuICAgICAgbGlua0lkID0gbGluay5pZDtcbiAgICB9XG5cbiAgICByZXR1cm4gc3ByaW5nc1tsaW5rSWRdO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0Qm9keShub2RlSWQpIHtcbiAgICByZXR1cm4gbm9kZUJvZGllc1tub2RlSWRdO1xuICB9XG5cbiAgZnVuY3Rpb24gbGlzdGVuVG9HcmFwaEV2ZW50cygpIHtcbiAgICBncmFwaC5vbignY2hhbmdlZCcsIG9uR3JhcGhDaGFuZ2VkKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uR3JhcGhDaGFuZ2VkKGNoYW5nZXMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNoYW5nZXMubGVuZ3RoOyArK2kpIHtcbiAgICAgIHZhciBjaGFuZ2UgPSBjaGFuZ2VzW2ldO1xuICAgICAgaWYgKGNoYW5nZS5jaGFuZ2VUeXBlID09PSAnYWRkJykge1xuICAgICAgICBpZiAoY2hhbmdlLm5vZGUpIHtcbiAgICAgICAgICBpbml0Qm9keShjaGFuZ2Uubm9kZS5pZCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoYW5nZS5saW5rKSB7XG4gICAgICAgICAgaW5pdExpbmsoY2hhbmdlLmxpbmspO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGNoYW5nZS5jaGFuZ2VUeXBlID09PSAncmVtb3ZlJykge1xuICAgICAgICBpZiAoY2hhbmdlLm5vZGUpIHtcbiAgICAgICAgICByZWxlYXNlTm9kZShjaGFuZ2Uubm9kZSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGNoYW5nZS5saW5rKSB7XG4gICAgICAgICAgcmVsZWFzZUxpbmsoY2hhbmdlLmxpbmspO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdFBoeXNpY3MoKSB7XG4gICAgZ3JhcGguZm9yRWFjaE5vZGUoZnVuY3Rpb24gKG5vZGUpIHtcbiAgICAgIGluaXRCb2R5KG5vZGUuaWQpO1xuICAgIH0pO1xuICAgIGdyYXBoLmZvckVhY2hMaW5rKGluaXRMaW5rKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRCb2R5KG5vZGVJZCkge1xuICAgIHZhciBib2R5ID0gbm9kZUJvZGllc1tub2RlSWRdO1xuICAgIGlmICghYm9keSkge1xuICAgICAgdmFyIG5vZGUgPSBncmFwaC5nZXROb2RlKG5vZGVJZCk7XG4gICAgICBpZiAoIW5vZGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdpbml0Qm9keSgpIHdhcyBjYWxsZWQgd2l0aCB1bmtub3duIG5vZGUgaWQnKTtcbiAgICAgIH1cblxuICAgICAgdmFyIHBvcyA9IG5vZGUucG9zaXRpb247XG4gICAgICBpZiAoIXBvcykge1xuICAgICAgICB2YXIgbmVpZ2hib3JzID0gZ2V0TmVpZ2hib3JCb2RpZXMobm9kZSk7XG4gICAgICAgIHBvcyA9IHBoeXNpY3NTaW11bGF0b3IuZ2V0QmVzdE5ld0JvZHlQb3NpdGlvbihuZWlnaGJvcnMpO1xuICAgICAgfVxuXG4gICAgICBib2R5ID0gcGh5c2ljc1NpbXVsYXRvci5hZGRCb2R5QXQocG9zKTtcblxuICAgICAgbm9kZUJvZGllc1tub2RlSWRdID0gYm9keTtcbiAgICAgIHVwZGF0ZUJvZHlNYXNzKG5vZGVJZCk7XG5cbiAgICAgIGlmIChpc05vZGVPcmlnaW5hbGx5UGlubmVkKG5vZGUpKSB7XG4gICAgICAgIGJvZHkuaXNQaW5uZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHJlbGVhc2VOb2RlKG5vZGUpIHtcbiAgICB2YXIgbm9kZUlkID0gbm9kZS5pZDtcbiAgICB2YXIgYm9keSA9IG5vZGVCb2RpZXNbbm9kZUlkXTtcbiAgICBpZiAoYm9keSkge1xuICAgICAgbm9kZUJvZGllc1tub2RlSWRdID0gbnVsbDtcbiAgICAgIGRlbGV0ZSBub2RlQm9kaWVzW25vZGVJZF07XG5cbiAgICAgIHBoeXNpY3NTaW11bGF0b3IucmVtb3ZlQm9keShib2R5KTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0TGluayhsaW5rKSB7XG4gICAgdXBkYXRlQm9keU1hc3MobGluay5mcm9tSWQpO1xuICAgIHVwZGF0ZUJvZHlNYXNzKGxpbmsudG9JZCk7XG5cbiAgICB2YXIgZnJvbUJvZHkgPSBub2RlQm9kaWVzW2xpbmsuZnJvbUlkXSxcbiAgICAgICAgdG9Cb2R5ICA9IG5vZGVCb2RpZXNbbGluay50b0lkXSxcbiAgICAgICAgc3ByaW5nID0gcGh5c2ljc1NpbXVsYXRvci5hZGRTcHJpbmcoZnJvbUJvZHksIHRvQm9keSwgbGluay5sZW5ndGgpO1xuXG4gICAgc3ByaW5nVHJhbnNmb3JtKGxpbmssIHNwcmluZyk7XG5cbiAgICBzcHJpbmdzW2xpbmsuaWRdID0gc3ByaW5nO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVsZWFzZUxpbmsobGluaykge1xuICAgIHZhciBzcHJpbmcgPSBzcHJpbmdzW2xpbmsuaWRdO1xuICAgIGlmIChzcHJpbmcpIHtcbiAgICAgIHZhciBmcm9tID0gZ3JhcGguZ2V0Tm9kZShsaW5rLmZyb21JZCksXG4gICAgICAgICAgdG8gPSBncmFwaC5nZXROb2RlKGxpbmsudG9JZCk7XG5cbiAgICAgIGlmIChmcm9tKSB1cGRhdGVCb2R5TWFzcyhmcm9tLmlkKTtcbiAgICAgIGlmICh0bykgdXBkYXRlQm9keU1hc3ModG8uaWQpO1xuXG4gICAgICBkZWxldGUgc3ByaW5nc1tsaW5rLmlkXTtcblxuICAgICAgcGh5c2ljc1NpbXVsYXRvci5yZW1vdmVTcHJpbmcoc3ByaW5nKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBnZXROZWlnaGJvckJvZGllcyhub2RlKSB7XG4gICAgLy8gVE9ETzogQ291bGQgcHJvYmFibHkgYmUgZG9uZSBiZXR0ZXIgb24gbWVtb3J5XG4gICAgdmFyIG5laWdoYm9ycyA9IFtdO1xuICAgIGlmICghbm9kZS5saW5rcykge1xuICAgICAgcmV0dXJuIG5laWdoYm9ycztcbiAgICB9XG4gICAgdmFyIG1heE5laWdoYm9ycyA9IE1hdGgubWluKG5vZGUubGlua3MubGVuZ3RoLCAyKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1heE5laWdoYm9yczsgKytpKSB7XG4gICAgICB2YXIgbGluayA9IG5vZGUubGlua3NbaV07XG4gICAgICB2YXIgb3RoZXJCb2R5ID0gbGluay5mcm9tSWQgIT09IG5vZGUuaWQgPyBub2RlQm9kaWVzW2xpbmsuZnJvbUlkXSA6IG5vZGVCb2RpZXNbbGluay50b0lkXTtcbiAgICAgIGlmIChvdGhlckJvZHkgJiYgb3RoZXJCb2R5LnBvcykge1xuICAgICAgICBuZWlnaGJvcnMucHVzaChvdGhlckJvZHkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBuZWlnaGJvcnM7XG4gIH1cblxuICBmdW5jdGlvbiB1cGRhdGVCb2R5TWFzcyhub2RlSWQpIHtcbiAgICB2YXIgYm9keSA9IG5vZGVCb2RpZXNbbm9kZUlkXTtcbiAgICBib2R5Lm1hc3MgPSBub2RlTWFzcyhub2RlSWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyB3aGV0aGVyIGdyYXBoIG5vZGUgaGFzIGluIGl0cyBzZXR0aW5ncyBwaW5uZWQgYXR0cmlidXRlLFxuICAgKiB3aGljaCBtZWFucyBsYXlvdXQgYWxnb3JpdGhtIGNhbm5vdCBtb3ZlIGl0LiBOb2RlIGNhbiBiZSBwcmVjb25maWd1cmVkXG4gICAqIGFzIHBpbm5lZCwgaWYgaXQgaGFzIFwiaXNQaW5uZWRcIiBhdHRyaWJ1dGUsIG9yIHdoZW4gbm9kZS5kYXRhIGhhcyBpdC5cbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IG5vZGUgYSBncmFwaCBub2RlIHRvIGNoZWNrXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IHRydWUgaWYgbm9kZSBzaG91bGQgYmUgdHJlYXRlZCBhcyBwaW5uZWQ7IGZhbHNlIG90aGVyd2lzZS5cbiAgICovXG4gIGZ1bmN0aW9uIGlzTm9kZU9yaWdpbmFsbHlQaW5uZWQobm9kZSkge1xuICAgIHJldHVybiAobm9kZSAmJiAobm9kZS5pc1Bpbm5lZCB8fCAobm9kZS5kYXRhICYmIG5vZGUuZGF0YS5pc1Bpbm5lZCkpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldEluaXRpYWxpemVkQm9keShub2RlSWQpIHtcbiAgICB2YXIgYm9keSA9IG5vZGVCb2RpZXNbbm9kZUlkXTtcbiAgICBpZiAoIWJvZHkpIHtcbiAgICAgIGluaXRCb2R5KG5vZGVJZCk7XG4gICAgICBib2R5ID0gbm9kZUJvZGllc1tub2RlSWRdO1xuICAgIH1cbiAgICByZXR1cm4gYm9keTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGVzIG1hc3Mgb2YgYSBib2R5LCB3aGljaCBjb3JyZXNwb25kcyB0byBub2RlIHdpdGggZ2l2ZW4gaWQuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfE51bWJlcn0gbm9kZUlkIGlkZW50aWZpZXIgb2YgYSBub2RlLCBmb3Igd2hpY2ggYm9keSBtYXNzIG5lZWRzIHRvIGJlIGNhbGN1bGF0ZWRcbiAgICogQHJldHVybnMge051bWJlcn0gcmVjb21tZW5kZWQgbWFzcyBvZiB0aGUgYm9keTtcbiAgICovXG4gIGZ1bmN0aW9uIG5vZGVNYXNzKG5vZGVJZCkge1xuICAgIHJldHVybiAxICsgZ3JhcGguZ2V0TGlua3Mobm9kZUlkKS5sZW5ndGggLyAzLjA7XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9vcCgpIHsgfVxuIiwiLyoqXG4gKiBNYW5hZ2VzIGEgc2ltdWxhdGlvbiBvZiBwaHlzaWNhbCBmb3JjZXMgYWN0aW5nIG9uIGJvZGllcyBhbmQgc3ByaW5ncy5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBwaHlzaWNzU2ltdWxhdG9yO1xuXG5mdW5jdGlvbiBwaHlzaWNzU2ltdWxhdG9yKHNldHRpbmdzKSB7XG4gIHZhciBTcHJpbmcgPSByZXF1aXJlKCcuL2xpYi9zcHJpbmcnKTtcbiAgdmFyIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyk7XG5cbiAgc2V0dGluZ3MgPSBtZXJnZShzZXR0aW5ncywge1xuICAgICAgLyoqXG4gICAgICAgKiBJZGVhbCBsZW5ndGggZm9yIGxpbmtzIChzcHJpbmdzIGluIHBoeXNpY2FsIG1vZGVsKS5cbiAgICAgICAqL1xuICAgICAgc3ByaW5nTGVuZ3RoOiAzMCxcblxuICAgICAgLyoqXG4gICAgICAgKiBIb29rJ3MgbGF3IGNvZWZmaWNpZW50LiAxIC0gc29saWQgc3ByaW5nLlxuICAgICAgICovXG4gICAgICBzcHJpbmdDb2VmZjogMC4wMDA4LFxuXG4gICAgICAvKipcbiAgICAgICAqIENvdWxvbWIncyBsYXcgY29lZmZpY2llbnQuIEl0J3MgdXNlZCB0byByZXBlbCBub2RlcyB0aHVzIHNob3VsZCBiZSBuZWdhdGl2ZVxuICAgICAgICogaWYgeW91IG1ha2UgaXQgcG9zaXRpdmUgbm9kZXMgc3RhcnQgYXR0cmFjdCBlYWNoIG90aGVyIDopLlxuICAgICAgICovXG4gICAgICBncmF2aXR5OiAtMS4yLFxuXG4gICAgICAvKipcbiAgICAgICAqIFRoZXRhIGNvZWZmaWNpZW50IGZyb20gQmFybmVzIEh1dCBzaW11bGF0aW9uLiBSYW5nZWQgYmV0d2VlbiAoMCwgMSkuXG4gICAgICAgKiBUaGUgY2xvc2VyIGl0J3MgdG8gMSB0aGUgbW9yZSBub2RlcyBhbGdvcml0aG0gd2lsbCBoYXZlIHRvIGdvIHRocm91Z2guXG4gICAgICAgKiBTZXR0aW5nIGl0IHRvIG9uZSBtYWtlcyBCYXJuZXMgSHV0IHNpbXVsYXRpb24gbm8gZGlmZmVyZW50IGZyb21cbiAgICAgICAqIGJydXRlLWZvcmNlIGZvcmNlcyBjYWxjdWxhdGlvbiAoZWFjaCBub2RlIGlzIGNvbnNpZGVyZWQpLlxuICAgICAgICovXG4gICAgICB0aGV0YTogMC44LFxuXG4gICAgICAvKipcbiAgICAgICAqIERyYWcgZm9yY2UgY29lZmZpY2llbnQuIFVzZWQgdG8gc2xvdyBkb3duIHN5c3RlbSwgdGh1cyBzaG91bGQgYmUgbGVzcyB0aGFuIDEuXG4gICAgICAgKiBUaGUgY2xvc2VyIGl0IGlzIHRvIDAgdGhlIGxlc3MgdGlnaHQgc3lzdGVtIHdpbGwgYmUuXG4gICAgICAgKi9cbiAgICAgIGRyYWdDb2VmZjogMC4wMixcblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZhdWx0IHRpbWUgc3RlcCAoZHQpIGZvciBmb3JjZXMgaW50ZWdyYXRpb25cbiAgICAgICAqL1xuICAgICAgdGltZVN0ZXAgOiAyMCxcblxuICAgICAgLyoqXG4gICAgICAgICogTWF4aW11bSBtb3ZlbWVudCBvZiB0aGUgc3lzdGVtIHdoaWNoIGNhbiBiZSBjb25zaWRlcmVkIGFzIHN0YWJpbGl6ZWRcbiAgICAgICAgKi9cbiAgICAgIHN0YWJsZVRocmVzaG9sZDogMC4wMDlcbiAgfSk7XG5cbiAgLy8gV2UgYWxsb3cgY2xpZW50cyB0byBvdmVycmlkZSBiYXNpYyBmYWN0b3J5IG1ldGhvZHM6XG4gIHZhciBjcmVhdGVRdWFkVHJlZSA9IHNldHRpbmdzLmNyZWF0ZVF1YWRUcmVlIHx8IHJlcXVpcmUoJ25ncmFwaC5xdWFkdHJlZWJoJyk7XG4gIHZhciBjcmVhdGVCb3VuZHMgPSBzZXR0aW5ncy5jcmVhdGVCb3VuZHMgfHwgcmVxdWlyZSgnLi9saWIvYm91bmRzJyk7XG4gIHZhciBjcmVhdGVEcmFnRm9yY2UgPSBzZXR0aW5ncy5jcmVhdGVEcmFnRm9yY2UgfHwgcmVxdWlyZSgnLi9saWIvZHJhZ0ZvcmNlJyk7XG4gIHZhciBjcmVhdGVTcHJpbmdGb3JjZSA9IHNldHRpbmdzLmNyZWF0ZVNwcmluZ0ZvcmNlIHx8IHJlcXVpcmUoJy4vbGliL3NwcmluZ0ZvcmNlJyk7XG4gIHZhciBpbnRlZ3JhdGUgPSBzZXR0aW5ncy5pbnRlZ3JhdG9yIHx8IHJlcXVpcmUoJy4vbGliL2V1bGVySW50ZWdyYXRvcicpO1xuICB2YXIgY3JlYXRlQm9keSA9IHNldHRpbmdzLmNyZWF0ZUJvZHkgfHwgcmVxdWlyZSgnLi9saWIvY3JlYXRlQm9keScpO1xuXG4gIHZhciBib2RpZXMgPSBbXSwgLy8gQm9kaWVzIGluIHRoaXMgc2ltdWxhdGlvbi5cbiAgICAgIHNwcmluZ3MgPSBbXSwgLy8gU3ByaW5ncyBpbiB0aGlzIHNpbXVsYXRpb24uXG4gICAgICBxdWFkVHJlZSA9ICBjcmVhdGVRdWFkVHJlZShzZXR0aW5ncyksXG4gICAgICBib3VuZHMgPSBjcmVhdGVCb3VuZHMoYm9kaWVzLCBzZXR0aW5ncyksXG4gICAgICBzcHJpbmdGb3JjZSA9IGNyZWF0ZVNwcmluZ0ZvcmNlKHNldHRpbmdzKSxcbiAgICAgIGRyYWdGb3JjZSA9IGNyZWF0ZURyYWdGb3JjZShzZXR0aW5ncyk7XG5cbiAgdmFyIHB1YmxpY0FwaSA9IHtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBib2RpZXMsIHJlZ2lzdGVyZWQgd2l0aCBjdXJyZW50IHNpbXVsYXRvclxuICAgICAqXG4gICAgICogTm90ZTogVG8gYWRkIG5ldyBib2R5LCB1c2UgYWRkQm9keSgpIG1ldGhvZC4gVGhpcyBwcm9wZXJ0eSBpcyBvbmx5XG4gICAgICogZXhwb3NlZCBmb3IgdGVzdGluZy9wZXJmb3JtYW5jZSBwdXJwb3Nlcy5cbiAgICAgKi9cbiAgICBib2RpZXM6IGJvZGllcyxcblxuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIHNwcmluZ3MsIHJlZ2lzdGVyZWQgd2l0aCBjdXJyZW50IHNpbXVsYXRvclxuICAgICAqXG4gICAgICogTm90ZTogVG8gYWRkIG5ldyBzcHJpbmcsIHVzZSBhZGRTcHJpbmcoKSBtZXRob2QuIFRoaXMgcHJvcGVydHkgaXMgb25seVxuICAgICAqIGV4cG9zZWQgZm9yIHRlc3RpbmcvcGVyZm9ybWFuY2UgcHVycG9zZXMuXG4gICAgICovXG4gICAgc3ByaW5nczogc3ByaW5ncyxcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgc2V0dGluZ3Mgd2l0aCB3aGljaCBjdXJyZW50IHNpbXVsYXRvciB3YXMgaW5pdGlhbGl6ZWRcbiAgICAgKi9cbiAgICBzZXR0aW5nczogc2V0dGluZ3MsXG5cbiAgICAvKipcbiAgICAgKiBQZXJmb3JtcyBvbmUgc3RlcCBvZiBmb3JjZSBzaW11bGF0aW9uLlxuICAgICAqXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgc3lzdGVtIGlzIGNvbnNpZGVyZWQgc3RhYmxlOyBGYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgc3RlcDogZnVuY3Rpb24gKCkge1xuICAgICAgYWNjdW11bGF0ZUZvcmNlcygpO1xuICAgICAgdmFyIHRvdGFsTW92ZW1lbnQgPSBpbnRlZ3JhdGUoYm9kaWVzLCBzZXR0aW5ncy50aW1lU3RlcCk7XG5cbiAgICAgIGJvdW5kcy51cGRhdGUoKTtcblxuICAgICAgcmV0dXJuIHRvdGFsTW92ZW1lbnQgPCBzZXR0aW5ncy5zdGFibGVUaHJlc2hvbGQ7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEFkZHMgYm9keSB0byB0aGUgc3lzdGVtXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMuQm9keX0gYm9keSBwaHlzaWNhbCBib2R5XG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7bmdyYXBoLnBoeXNpY3MucHJpbWl0aXZlcy5Cb2R5fSBhZGRlZCBib2R5XG4gICAgICovXG4gICAgYWRkQm9keTogZnVuY3Rpb24gKGJvZHkpIHtcbiAgICAgIGlmICghYm9keSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JvZHkgaXMgcmVxdWlyZWQnKTtcbiAgICAgIH1cbiAgICAgIGJvZGllcy5wdXNoKGJvZHkpO1xuXG4gICAgICByZXR1cm4gYm9keTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogQWRkcyBib2R5IHRvIHRoZSBzeXN0ZW0gYXQgZ2l2ZW4gcG9zaXRpb25cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwb3MgcG9zaXRpb24gb2YgYSBib2R5XG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7bmdyYXBoLnBoeXNpY3MucHJpbWl0aXZlcy5Cb2R5fSBhZGRlZCBib2R5XG4gICAgICovXG4gICAgYWRkQm9keUF0OiBmdW5jdGlvbiAocG9zKSB7XG4gICAgICBpZiAoIXBvcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JvZHkgcG9zaXRpb24gaXMgcmVxdWlyZWQnKTtcbiAgICAgIH1cbiAgICAgIHZhciBib2R5ID0gY3JlYXRlQm9keShwb3MpO1xuICAgICAgYm9kaWVzLnB1c2goYm9keSk7XG5cbiAgICAgIHJldHVybiBib2R5O1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmVzIGJvZHkgZnJvbSB0aGUgc3lzdGVtXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMuQm9keX0gYm9keSB0byByZW1vdmVcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHtCb29sZWFufSB0cnVlIGlmIGJvZHkgZm91bmQgYW5kIHJlbW92ZWQuIGZhbHN5IG90aGVyd2lzZTtcbiAgICAgKi9cbiAgICByZW1vdmVCb2R5OiBmdW5jdGlvbiAoYm9keSkge1xuICAgICAgaWYgKCFib2R5KSB7IHJldHVybjsgfVxuXG4gICAgICB2YXIgaWR4ID0gYm9kaWVzLmluZGV4T2YoYm9keSk7XG4gICAgICBpZiAoaWR4IDwgMCkgeyByZXR1cm47IH1cblxuICAgICAgYm9kaWVzLnNwbGljZShpZHgsIDEpO1xuICAgICAgaWYgKGJvZGllcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgYm91bmRzLnJlc2V0KCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogQWRkcyBhIHNwcmluZyB0byB0aGlzIHNpbXVsYXRpb24uXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSAtIGEgaGFuZGxlIGZvciBhIHNwcmluZy4gSWYgeW91IHdhbnQgdG8gbGF0ZXIgcmVtb3ZlXG4gICAgICogc3ByaW5nIHBhc3MgaXQgdG8gcmVtb3ZlU3ByaW5nKCkgbWV0aG9kLlxuICAgICAqL1xuICAgIGFkZFNwcmluZzogZnVuY3Rpb24gKGJvZHkxLCBib2R5Miwgc3ByaW5nTGVuZ3RoLCBzcHJpbmdXZWlnaHQsIHNwcmluZ0NvZWZmaWNpZW50KSB7XG4gICAgICBpZiAoIWJvZHkxIHx8ICFib2R5Mikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBhZGQgbnVsbCBzcHJpbmcgdG8gZm9yY2Ugc2ltdWxhdG9yJyk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2Ygc3ByaW5nTGVuZ3RoICE9PSAnbnVtYmVyJykge1xuICAgICAgICBzcHJpbmdMZW5ndGggPSAtMTsgLy8gYXNzdW1lIGdsb2JhbCBjb25maWd1cmF0aW9uXG4gICAgICB9XG5cbiAgICAgIHZhciBzcHJpbmcgPSBuZXcgU3ByaW5nKGJvZHkxLCBib2R5Miwgc3ByaW5nTGVuZ3RoLCBzcHJpbmdDb2VmZmljaWVudCA+PSAwID8gc3ByaW5nQ29lZmZpY2llbnQgOiAtMSwgc3ByaW5nV2VpZ2h0KTtcbiAgICAgIHNwcmluZ3MucHVzaChzcHJpbmcpO1xuXG4gICAgICAvLyBUT0RPOiBjb3VsZCBtYXJrIHNpbXVsYXRvciBhcyBkaXJ0eS5cbiAgICAgIHJldHVybiBzcHJpbmc7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJlbW92ZXMgc3ByaW5nIGZyb20gdGhlIHN5c3RlbVxuICAgICAqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHNwcmluZyB0byByZW1vdmUuIFNwcmluZyBpcyBhbiBvYmplY3QgcmV0dXJuZWQgYnkgYWRkU3ByaW5nXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7Qm9vbGVhbn0gdHJ1ZSBpZiBzcHJpbmcgZm91bmQgYW5kIHJlbW92ZWQuIGZhbHN5IG90aGVyd2lzZTtcbiAgICAgKi9cbiAgICByZW1vdmVTcHJpbmc6IGZ1bmN0aW9uIChzcHJpbmcpIHtcbiAgICAgIGlmICghc3ByaW5nKSB7IHJldHVybjsgfVxuICAgICAgdmFyIGlkeCA9IHNwcmluZ3MuaW5kZXhPZihzcHJpbmcpO1xuICAgICAgaWYgKGlkeCA+IC0xKSB7XG4gICAgICAgIHNwcmluZ3Muc3BsaWNlKGlkeCwgMSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBnZXRCZXN0TmV3Qm9keVBvc2l0aW9uOiBmdW5jdGlvbiAobmVpZ2hib3JzKSB7XG4gICAgICByZXR1cm4gYm91bmRzLmdldEJlc3ROZXdQb3NpdGlvbihuZWlnaGJvcnMpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGJvdW5kaW5nIGJveCB3aGljaCBjb3ZlcnMgYWxsIGJvZGllc1xuICAgICAqL1xuICAgIGdldEJCb3g6IGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiBib3VuZHMuYm94O1xuICAgIH0sXG5cbiAgICBncmF2aXR5OiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNldHRpbmdzLmdyYXZpdHkgPSB2YWx1ZTtcbiAgICAgICAgcXVhZFRyZWUub3B0aW9ucyh7Z3Jhdml0eTogdmFsdWV9KTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gc2V0dGluZ3MuZ3Jhdml0eTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdGhldGE6IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc2V0dGluZ3MudGhldGEgPSB2YWx1ZTtcbiAgICAgICAgcXVhZFRyZWUub3B0aW9ucyh7dGhldGE6IHZhbHVlfSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHNldHRpbmdzLnRoZXRhO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICAvLyBhbGxvdyBzZXR0aW5ncyBtb2RpZmljYXRpb24gdmlhIHB1YmxpYyBBUEk6XG4gIGV4cG9zZShzZXR0aW5ncywgcHVibGljQXBpKTtcblxuICByZXR1cm4gcHVibGljQXBpO1xuXG4gIGZ1bmN0aW9uIGFjY3VtdWxhdGVGb3JjZXMoKSB7XG4gICAgLy8gQWNjdW11bGF0ZSBmb3JjZXMgYWN0aW5nIG9uIGJvZGllcy5cbiAgICB2YXIgYm9keSxcbiAgICAgICAgaSA9IGJvZGllcy5sZW5ndGg7XG5cbiAgICBpZiAoaSkge1xuICAgICAgLy8gb25seSBhZGQgYm9kaWVzIGlmIHRoZXJlIHRoZSBhcnJheSBpcyBub3QgZW1wdHk6XG4gICAgICBxdWFkVHJlZS5pbnNlcnRCb2RpZXMoYm9kaWVzKTsgLy8gcGVyZm9ybWFuY2U6IE8obiAqIGxvZyBuKVxuICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICBib2R5ID0gYm9kaWVzW2ldO1xuICAgICAgICAvLyBJZiBib2R5IGlzIHBpbm5lZCB0aGVyZSBpcyBubyBwb2ludCB1cGRhdGluZyBpdHMgZm9yY2VzIC0gaXQgc2hvdWxkXG4gICAgICAgIC8vIG5ldmVyIG1vdmU6XG4gICAgICAgIGlmICghYm9keS5pc1Bpbm5lZCkge1xuICAgICAgICAgIGJvZHkuZm9yY2UucmVzZXQoKTtcblxuICAgICAgICAgIHF1YWRUcmVlLnVwZGF0ZUJvZHlGb3JjZShib2R5KTtcbiAgICAgICAgICBkcmFnRm9yY2UudXBkYXRlKGJvZHkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaSA9IHNwcmluZ3MubGVuZ3RoO1xuICAgIHdoaWxlKGktLSkge1xuICAgICAgc3ByaW5nRm9yY2UudXBkYXRlKHNwcmluZ3NbaV0pO1xuICAgIH1cbiAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGJvZGllcywgc2V0dGluZ3MpIHtcbiAgdmFyIHJhbmRvbSA9IHJlcXVpcmUoJ25ncmFwaC5yYW5kb20nKS5yYW5kb20oNDIpO1xuICB2YXIgYm91bmRpbmdCb3ggPSAgeyB4MTogMCwgeTE6IDAsIHgyOiAwLCB5MjogMCB9O1xuXG4gIHJldHVybiB7XG4gICAgYm94OiBib3VuZGluZ0JveCxcblxuICAgIHVwZGF0ZTogdXBkYXRlQm91bmRpbmdCb3gsXG5cbiAgICByZXNldCA6IGZ1bmN0aW9uICgpIHtcbiAgICAgIGJvdW5kaW5nQm94LngxID0gYm91bmRpbmdCb3gueTEgPSAwO1xuICAgICAgYm91bmRpbmdCb3gueDIgPSBib3VuZGluZ0JveC55MiA9IDA7XG4gICAgfSxcblxuICAgIGdldEJlc3ROZXdQb3NpdGlvbjogZnVuY3Rpb24gKG5laWdoYm9ycykge1xuICAgICAgdmFyIGdyYXBoUmVjdCA9IGJvdW5kaW5nQm94O1xuXG4gICAgICB2YXIgYmFzZVggPSAwLCBiYXNlWSA9IDA7XG5cbiAgICAgIGlmIChuZWlnaGJvcnMubGVuZ3RoKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmVpZ2hib3JzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgYmFzZVggKz0gbmVpZ2hib3JzW2ldLnBvcy54O1xuICAgICAgICAgIGJhc2VZICs9IG5laWdoYm9yc1tpXS5wb3MueTtcbiAgICAgICAgfVxuXG4gICAgICAgIGJhc2VYIC89IG5laWdoYm9ycy5sZW5ndGg7XG4gICAgICAgIGJhc2VZIC89IG5laWdoYm9ycy5sZW5ndGg7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBiYXNlWCA9IChncmFwaFJlY3QueDEgKyBncmFwaFJlY3QueDIpIC8gMjtcbiAgICAgICAgYmFzZVkgPSAoZ3JhcGhSZWN0LnkxICsgZ3JhcGhSZWN0LnkyKSAvIDI7XG4gICAgICB9XG5cbiAgICAgIHZhciBzcHJpbmdMZW5ndGggPSBzZXR0aW5ncy5zcHJpbmdMZW5ndGg7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB4OiBiYXNlWCArIHJhbmRvbS5uZXh0KHNwcmluZ0xlbmd0aCkgLSBzcHJpbmdMZW5ndGggLyAyLFxuICAgICAgICB5OiBiYXNlWSArIHJhbmRvbS5uZXh0KHNwcmluZ0xlbmd0aCkgLSBzcHJpbmdMZW5ndGggLyAyXG4gICAgICB9O1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiB1cGRhdGVCb3VuZGluZ0JveCgpIHtcbiAgICB2YXIgaSA9IGJvZGllcy5sZW5ndGg7XG4gICAgaWYgKGkgPT09IDApIHsgcmV0dXJuOyB9IC8vIGRvbid0IGhhdmUgdG8gd29yeSBoZXJlLlxuXG4gICAgdmFyIHgxID0gTnVtYmVyLk1BWF9WQUxVRSxcbiAgICAgICAgeTEgPSBOdW1iZXIuTUFYX1ZBTFVFLFxuICAgICAgICB4MiA9IE51bWJlci5NSU5fVkFMVUUsXG4gICAgICAgIHkyID0gTnVtYmVyLk1JTl9WQUxVRTtcblxuICAgIHdoaWxlKGktLSkge1xuICAgICAgLy8gdGhpcyBpcyBPKG4pLCBjb3VsZCBpdCBiZSBkb25lIGZhc3RlciB3aXRoIHF1YWR0cmVlP1xuICAgICAgLy8gaG93IGFib3V0IHBpbm5lZCBub2Rlcz9cbiAgICAgIHZhciBib2R5ID0gYm9kaWVzW2ldO1xuICAgICAgaWYgKGJvZHkuaXNQaW5uZWQpIHtcbiAgICAgICAgYm9keS5wb3MueCA9IGJvZHkucHJldlBvcy54O1xuICAgICAgICBib2R5LnBvcy55ID0gYm9keS5wcmV2UG9zLnk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBib2R5LnByZXZQb3MueCA9IGJvZHkucG9zLng7XG4gICAgICAgIGJvZHkucHJldlBvcy55ID0gYm9keS5wb3MueTtcbiAgICAgIH1cbiAgICAgIGlmIChib2R5LnBvcy54IDwgeDEpIHtcbiAgICAgICAgeDEgPSBib2R5LnBvcy54O1xuICAgICAgfVxuICAgICAgaWYgKGJvZHkucG9zLnggPiB4Mikge1xuICAgICAgICB4MiA9IGJvZHkucG9zLng7XG4gICAgICB9XG4gICAgICBpZiAoYm9keS5wb3MueSA8IHkxKSB7XG4gICAgICAgIHkxID0gYm9keS5wb3MueTtcbiAgICAgIH1cbiAgICAgIGlmIChib2R5LnBvcy55ID4geTIpIHtcbiAgICAgICAgeTIgPSBib2R5LnBvcy55O1xuICAgICAgfVxuICAgIH1cblxuICAgIGJvdW5kaW5nQm94LngxID0geDE7XG4gICAgYm91bmRpbmdCb3gueDIgPSB4MjtcbiAgICBib3VuZGluZ0JveC55MSA9IHkxO1xuICAgIGJvdW5kaW5nQm94LnkyID0geTI7XG4gIH1cbn1cbiIsInZhciBwaHlzaWNzID0gcmVxdWlyZSgnbmdyYXBoLnBoeXNpY3MucHJpbWl0aXZlcycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHBvcykge1xuICByZXR1cm4gbmV3IHBoeXNpY3MuQm9keShwb3MpO1xufVxuIiwiLyoqXG4gKiBSZXByZXNlbnRzIGRyYWcgZm9yY2UsIHdoaWNoIHJlZHVjZXMgZm9yY2UgdmFsdWUgb24gZWFjaCBzdGVwIGJ5IGdpdmVuXG4gKiBjb2VmZmljaWVudC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBmb3IgdGhlIGRyYWcgZm9yY2VcbiAqIEBwYXJhbSB7TnVtYmVyPX0gb3B0aW9ucy5kcmFnQ29lZmYgZHJhZyBmb3JjZSBjb2VmZmljaWVudC4gMC4xIGJ5IGRlZmF1bHRcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICB2YXIgbWVyZ2UgPSByZXF1aXJlKCduZ3JhcGgubWVyZ2UnKSxcbiAgICAgIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcblxuICBvcHRpb25zID0gbWVyZ2Uob3B0aW9ucywge1xuICAgIGRyYWdDb2VmZjogMC4wMlxuICB9KTtcblxuICB2YXIgYXBpID0ge1xuICAgIHVwZGF0ZSA6IGZ1bmN0aW9uIChib2R5KSB7XG4gICAgICBib2R5LmZvcmNlLnggLT0gb3B0aW9ucy5kcmFnQ29lZmYgKiBib2R5LnZlbG9jaXR5Lng7XG4gICAgICBib2R5LmZvcmNlLnkgLT0gb3B0aW9ucy5kcmFnQ29lZmYgKiBib2R5LnZlbG9jaXR5Lnk7XG4gICAgfVxuICB9O1xuXG4gIC8vIGxldCBlYXN5IGFjY2VzcyB0byBkcmFnQ29lZmY6XG4gIGV4cG9zZShvcHRpb25zLCBhcGksIFsnZHJhZ0NvZWZmJ10pO1xuXG4gIHJldHVybiBhcGk7XG59O1xuIiwiLyoqXG4gKiBQZXJmb3JtcyBmb3JjZXMgaW50ZWdyYXRpb24sIHVzaW5nIGdpdmVuIHRpbWVzdGVwLiBVc2VzIEV1bGVyIG1ldGhvZCB0byBzb2x2ZVxuICogZGlmZmVyZW50aWFsIGVxdWF0aW9uIChodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0V1bGVyX21ldGhvZCApLlxuICpcbiAqIEByZXR1cm5zIHtOdW1iZXJ9IHNxdWFyZWQgZGlzdGFuY2Ugb2YgdG90YWwgcG9zaXRpb24gdXBkYXRlcy5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGludGVncmF0ZTtcblxuZnVuY3Rpb24gaW50ZWdyYXRlKGJvZGllcywgdGltZVN0ZXApIHtcbiAgdmFyIGR4ID0gMCwgdHggPSAwLFxuICAgICAgZHkgPSAwLCB0eSA9IDAsXG4gICAgICBpLFxuICAgICAgbWF4ID0gYm9kaWVzLmxlbmd0aDtcblxuICBmb3IgKGkgPSAwOyBpIDwgbWF4OyArK2kpIHtcbiAgICB2YXIgYm9keSA9IGJvZGllc1tpXSxcbiAgICAgICAgY29lZmYgPSB0aW1lU3RlcCAvIGJvZHkubWFzcztcblxuICAgIGJvZHkudmVsb2NpdHkueCArPSBjb2VmZiAqIGJvZHkuZm9yY2UueDtcbiAgICBib2R5LnZlbG9jaXR5LnkgKz0gY29lZmYgKiBib2R5LmZvcmNlLnk7XG4gICAgdmFyIHZ4ID0gYm9keS52ZWxvY2l0eS54LFxuICAgICAgICB2eSA9IGJvZHkudmVsb2NpdHkueSxcbiAgICAgICAgdiA9IE1hdGguc3FydCh2eCAqIHZ4ICsgdnkgKiB2eSk7XG5cbiAgICBpZiAodiA+IDEpIHtcbiAgICAgIGJvZHkudmVsb2NpdHkueCA9IHZ4IC8gdjtcbiAgICAgIGJvZHkudmVsb2NpdHkueSA9IHZ5IC8gdjtcbiAgICB9XG5cbiAgICBkeCA9IHRpbWVTdGVwICogYm9keS52ZWxvY2l0eS54O1xuICAgIGR5ID0gdGltZVN0ZXAgKiBib2R5LnZlbG9jaXR5Lnk7XG5cbiAgICBib2R5LnBvcy54ICs9IGR4O1xuICAgIGJvZHkucG9zLnkgKz0gZHk7XG5cbiAgICB0eCArPSBNYXRoLmFicyhkeCk7IHR5ICs9IE1hdGguYWJzKGR5KTtcbiAgfVxuXG4gIHJldHVybiAodHggKiB0eCArIHR5ICogdHkpL2JvZGllcy5sZW5ndGg7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFNwcmluZztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgcGh5c2ljYWwgc3ByaW5nLiBTcHJpbmcgY29ubmVjdHMgdHdvIGJvZGllcywgaGFzIHJlc3QgbGVuZ3RoXG4gKiBzdGlmZm5lc3MgY29lZmZpY2llbnQgYW5kIG9wdGlvbmFsIHdlaWdodFxuICovXG5mdW5jdGlvbiBTcHJpbmcoZnJvbUJvZHksIHRvQm9keSwgbGVuZ3RoLCBjb2VmZiwgd2VpZ2h0KSB7XG4gICAgdGhpcy5mcm9tID0gZnJvbUJvZHk7XG4gICAgdGhpcy50byA9IHRvQm9keTtcbiAgICB0aGlzLmxlbmd0aCA9IGxlbmd0aDtcbiAgICB0aGlzLmNvZWZmID0gY29lZmY7XG5cbiAgICB0aGlzLndlaWdodCA9IHR5cGVvZiB3ZWlnaHQgPT09ICdudW1iZXInID8gd2VpZ2h0IDogMTtcbn07XG4iLCIvKipcbiAqIFJlcHJlc2VudHMgc3ByaW5nIGZvcmNlLCB3aGljaCB1cGRhdGVzIGZvcmNlcyBhY3Rpbmcgb24gdHdvIGJvZGllcywgY29ubnRlY3RlZFxuICogYnkgYSBzcHJpbmcuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgZm9yIHRoZSBzcHJpbmcgZm9yY2VcbiAqIEBwYXJhbSB7TnVtYmVyPX0gb3B0aW9ucy5zcHJpbmdDb2VmZiBzcHJpbmcgZm9yY2UgY29lZmZpY2llbnQuXG4gKiBAcGFyYW0ge051bWJlcj19IG9wdGlvbnMuc3ByaW5nTGVuZ3RoIGRlc2lyZWQgbGVuZ3RoIG9mIGEgc3ByaW5nIGF0IHJlc3QuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyk7XG4gIHZhciByYW5kb20gPSByZXF1aXJlKCduZ3JhcGgucmFuZG9tJykucmFuZG9tKDQyKTtcbiAgdmFyIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcblxuICBvcHRpb25zID0gbWVyZ2Uob3B0aW9ucywge1xuICAgIHNwcmluZ0NvZWZmOiAwLjAwMDIsXG4gICAgc3ByaW5nTGVuZ3RoOiA4MFxuICB9KTtcblxuICB2YXIgYXBpID0ge1xuICAgIC8qKlxuICAgICAqIFVwc2F0ZXMgZm9yY2VzIGFjdGluZyBvbiBhIHNwcmluZ1xuICAgICAqL1xuICAgIHVwZGF0ZSA6IGZ1bmN0aW9uIChzcHJpbmcpIHtcbiAgICAgIHZhciBib2R5MSA9IHNwcmluZy5mcm9tLFxuICAgICAgICAgIGJvZHkyID0gc3ByaW5nLnRvLFxuICAgICAgICAgIGxlbmd0aCA9IHNwcmluZy5sZW5ndGggPCAwID8gb3B0aW9ucy5zcHJpbmdMZW5ndGggOiBzcHJpbmcubGVuZ3RoLFxuICAgICAgICAgIGR4ID0gYm9keTIucG9zLnggLSBib2R5MS5wb3MueCxcbiAgICAgICAgICBkeSA9IGJvZHkyLnBvcy55IC0gYm9keTEucG9zLnksXG4gICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSk7XG5cbiAgICAgIGlmIChyID09PSAwKSB7XG4gICAgICAgICAgZHggPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICBkeSA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xuICAgICAgfVxuXG4gICAgICB2YXIgZCA9IHIgLSBsZW5ndGg7XG4gICAgICB2YXIgY29lZmYgPSAoKCFzcHJpbmcuY29lZmYgfHwgc3ByaW5nLmNvZWZmIDwgMCkgPyBvcHRpb25zLnNwcmluZ0NvZWZmIDogc3ByaW5nLmNvZWZmKSAqIGQgLyByICogc3ByaW5nLndlaWdodDtcblxuICAgICAgYm9keTEuZm9yY2UueCArPSBjb2VmZiAqIGR4O1xuICAgICAgYm9keTEuZm9yY2UueSArPSBjb2VmZiAqIGR5O1xuXG4gICAgICBib2R5Mi5mb3JjZS54IC09IGNvZWZmICogZHg7XG4gICAgICBib2R5Mi5mb3JjZS55IC09IGNvZWZmICogZHk7XG4gICAgfVxuICB9O1xuXG4gIGV4cG9zZShvcHRpb25zLCBhcGksIFsnc3ByaW5nQ29lZmYnLCAnc3ByaW5nTGVuZ3RoJ10pO1xuICByZXR1cm4gYXBpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBsb2FkO1xuXG52YXIgY3JlYXRlR3JhcGggPSByZXF1aXJlKCduZ3JhcGguZ3JhcGgnKTtcblxuZnVuY3Rpb24gbG9hZChqc29uR3JhcGgsIG5vZGVUcmFuc2Zvcm0sIGxpbmtUcmFuc2Zvcm0pIHtcbiAgdmFyIHN0b3JlZDtcbiAgbm9kZVRyYW5zZm9ybSA9IG5vZGVUcmFuc2Zvcm0gfHwgaWQ7XG4gIGxpbmtUcmFuc2Zvcm0gPSBsaW5rVHJhbnNmb3JtIHx8IGlkO1xuICBpZiAodHlwZW9mIGpzb25HcmFwaCA9PT0gJ3N0cmluZycpIHtcbiAgICBzdG9yZWQgPSBKU09OLnBhcnNlKGpzb25HcmFwaCk7XG4gIH0gZWxzZSB7XG4gICAgc3RvcmVkID0ganNvbkdyYXBoO1xuICB9XG5cbiAgdmFyIGdyYXBoID0gY3JlYXRlR3JhcGgoKSxcbiAgICAgIGk7XG5cbiAgaWYgKHN0b3JlZC5saW5rcyA9PT0gdW5kZWZpbmVkIHx8IHN0b3JlZC5ub2RlcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgbG9hZCBncmFwaCB3aXRob3V0IGxpbmtzIGFuZCBub2RlcycpO1xuICB9XG5cbiAgZm9yIChpID0gMDsgaSA8IHN0b3JlZC5ub2Rlcy5sZW5ndGg7ICsraSkge1xuICAgIHZhciBwYXJzZWROb2RlID0gbm9kZVRyYW5zZm9ybShzdG9yZWQubm9kZXNbaV0pO1xuICAgIGlmICghcGFyc2VkTm9kZS5oYXNPd25Qcm9wZXJ0eSgnaWQnKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdHcmFwaCBub2RlIGZvcm1hdCBpcyBpbnZhbGlkOiBOb2RlIGlkIGlzIG1pc3NpbmcnKTtcbiAgICB9XG5cbiAgICBncmFwaC5hZGROb2RlKHBhcnNlZE5vZGUuaWQsIHBhcnNlZE5vZGUuZGF0YSk7XG4gIH1cblxuICBmb3IgKGkgPSAwOyBpIDwgc3RvcmVkLmxpbmtzLmxlbmd0aDsgKytpKSB7XG4gICAgdmFyIGxpbmsgPSBsaW5rVHJhbnNmb3JtKHN0b3JlZC5saW5rc1tpXSk7XG4gICAgaWYgKCFsaW5rLmhhc093blByb3BlcnR5KCdmcm9tSWQnKSB8fCAhbGluay5oYXNPd25Qcm9wZXJ0eSgndG9JZCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0dyYXBoIGxpbmsgZm9ybWF0IGlzIGludmFsaWQuIEJvdGggZnJvbUlkIGFuZCB0b0lkIGFyZSByZXF1aXJlZCcpO1xuICAgIH1cblxuICAgIGdyYXBoLmFkZExpbmsobGluay5mcm9tSWQsIGxpbmsudG9JZCwgbGluay5kYXRhKTtcbiAgfVxuXG4gIHJldHVybiBncmFwaDtcbn1cblxuZnVuY3Rpb24gaWQoeCkgeyByZXR1cm4geDsgfVxuIiwiLyoqXG4gKiBAZmlsZU92ZXJ2aWV3IENvbnRhaW5zIGRlZmluaXRpb24gb2YgdGhlIGNvcmUgZ3JhcGggb2JqZWN0LlxuICovXG5cbi8qKlxuICogQGV4YW1wbGVcbiAqICB2YXIgZ3JhcGggPSByZXF1aXJlKCduZ3JhcGguZ3JhcGgnKSgpO1xuICogIGdyYXBoLmFkZE5vZGUoMSk7ICAgICAvLyBncmFwaCBoYXMgb25lIG5vZGUuXG4gKiAgZ3JhcGguYWRkTGluaygyLCAzKTsgIC8vIG5vdyBncmFwaCBjb250YWlucyB0aHJlZSBub2RlcyBhbmQgb25lIGxpbmsuXG4gKlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZUdyYXBoO1xuXG52YXIgZXZlbnRpZnkgPSByZXF1aXJlKCduZ3JhcGguZXZlbnRzJyk7XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBncmFwaFxuICovXG5mdW5jdGlvbiBjcmVhdGVHcmFwaChvcHRpb25zKSB7XG4gIC8vIEdyYXBoIHN0cnVjdHVyZSBpcyBtYWludGFpbmVkIGFzIGRpY3Rpb25hcnkgb2Ygbm9kZXNcbiAgLy8gYW5kIGFycmF5IG9mIGxpbmtzLiBFYWNoIG5vZGUgaGFzICdsaW5rcycgcHJvcGVydHkgd2hpY2hcbiAgLy8gaG9sZCBhbGwgbGlua3MgcmVsYXRlZCB0byB0aGF0IG5vZGUuIEFuZCBnZW5lcmFsIGxpbmtzXG4gIC8vIGFycmF5IGlzIHVzZWQgdG8gc3BlZWQgdXAgYWxsIGxpbmtzIGVudW1lcmF0aW9uLiBUaGlzIGlzIGluZWZmaWNpZW50XG4gIC8vIGluIHRlcm1zIG9mIG1lbW9yeSwgYnV0IHNpbXBsaWZpZXMgY29kaW5nLlxuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgaWYgKG9wdGlvbnMudW5pcXVlTGlua0lkID09PSB1bmRlZmluZWQpIHtcbiAgICAvLyBSZXF1ZXN0IGVhY2ggbGluayBpZCB0byBiZSB1bmlxdWUgYmV0d2VlbiBzYW1lIG5vZGVzLiBUaGlzIG5lZ2F0aXZlbHlcbiAgICAvLyBpbXBhY3RzIGBhZGRMaW5rKClgIHBlcmZvcm1hbmNlIChPKG4pLCB3aGVyZSBuIC0gbnVtYmVyIG9mIGVkZ2VzIG9mIGVhY2hcbiAgICAvLyB2ZXJ0ZXgpLCBidXQgbWFrZXMgb3BlcmF0aW9ucyB3aXRoIG11bHRpZ3JhcGhzIG1vcmUgYWNjZXNzaWJsZS5cbiAgICBvcHRpb25zLnVuaXF1ZUxpbmtJZCA9IHRydWU7XG4gIH1cblxuICB2YXIgbm9kZXMgPSB0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJyA/IE9iamVjdC5jcmVhdGUobnVsbCkgOiB7fSxcbiAgICBsaW5rcyA9IFtdLFxuICAgIC8vIEhhc2ggb2YgbXVsdGktZWRnZXMuIFVzZWQgdG8gdHJhY2sgaWRzIG9mIGVkZ2VzIGJldHdlZW4gc2FtZSBub2Rlc1xuICAgIG11bHRpRWRnZXMgPSB7fSxcbiAgICBub2Rlc0NvdW50ID0gMCxcbiAgICBzdXNwZW5kRXZlbnRzID0gMCxcblxuICAgIGZvckVhY2hOb2RlID0gY3JlYXRlTm9kZUl0ZXJhdG9yKCksXG4gICAgY3JlYXRlTGluayA9IG9wdGlvbnMudW5pcXVlTGlua0lkID8gY3JlYXRlVW5pcXVlTGluayA6IGNyZWF0ZVNpbmdsZUxpbmssXG5cbiAgICAvLyBPdXIgZ3JhcGggQVBJIHByb3ZpZGVzIG1lYW5zIHRvIGxpc3RlbiB0byBncmFwaCBjaGFuZ2VzLiBVc2VycyBjYW4gc3Vic2NyaWJlXG4gICAgLy8gdG8gYmUgbm90aWZpZWQgYWJvdXQgY2hhbmdlcyBpbiB0aGUgZ3JhcGggYnkgdXNpbmcgYG9uYCBtZXRob2QuIEhvd2V2ZXJcbiAgICAvLyBpbiBzb21lIGNhc2VzIHRoZXkgZG9uJ3QgdXNlIGl0LiBUbyBhdm9pZCB1bm5lY2Vzc2FyeSBtZW1vcnkgY29uc3VtcHRpb25cbiAgICAvLyB3ZSB3aWxsIG5vdCByZWNvcmQgZ3JhcGggY2hhbmdlcyB1bnRpbCB3ZSBoYXZlIGF0IGxlYXN0IG9uZSBzdWJzY3JpYmVyLlxuICAgIC8vIENvZGUgYmVsb3cgc3VwcG9ydHMgdGhpcyBvcHRpbWl6YXRpb24uXG4gICAgLy9cbiAgICAvLyBBY2N1bXVsYXRlcyBhbGwgY2hhbmdlcyBtYWRlIGR1cmluZyBncmFwaCB1cGRhdGVzLlxuICAgIC8vIEVhY2ggY2hhbmdlIGVsZW1lbnQgY29udGFpbnM6XG4gICAgLy8gIGNoYW5nZVR5cGUgLSBvbmUgb2YgdGhlIHN0cmluZ3M6ICdhZGQnLCAncmVtb3ZlJyBvciAndXBkYXRlJztcbiAgICAvLyAgbm9kZSAtIGlmIGNoYW5nZSBpcyByZWxhdGVkIHRvIG5vZGUgdGhpcyBwcm9wZXJ0eSBpcyBzZXQgdG8gY2hhbmdlZCBncmFwaCdzIG5vZGU7XG4gICAgLy8gIGxpbmsgLSBpZiBjaGFuZ2UgaXMgcmVsYXRlZCB0byBsaW5rIHRoaXMgcHJvcGVydHkgaXMgc2V0IHRvIGNoYW5nZWQgZ3JhcGgncyBsaW5rO1xuICAgIGNoYW5nZXMgPSBbXSxcbiAgICByZWNvcmRMaW5rQ2hhbmdlID0gbm9vcCxcbiAgICByZWNvcmROb2RlQ2hhbmdlID0gbm9vcCxcbiAgICBlbnRlck1vZGlmaWNhdGlvbiA9IG5vb3AsXG4gICAgZXhpdE1vZGlmaWNhdGlvbiA9IG5vb3A7XG5cbiAgLy8gdGhpcyBpcyBvdXIgcHVibGljIEFQSTpcbiAgdmFyIGdyYXBoUGFydCA9IHtcbiAgICAvKipcbiAgICAgKiBBZGRzIG5vZGUgdG8gdGhlIGdyYXBoLiBJZiBub2RlIHdpdGggZ2l2ZW4gaWQgYWxyZWFkeSBleGlzdHMgaW4gdGhlIGdyYXBoXG4gICAgICogaXRzIGRhdGEgaXMgZXh0ZW5kZWQgd2l0aCB3aGF0ZXZlciBjb21lcyBpbiAnZGF0YScgYXJndW1lbnQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbm9kZUlkIHRoZSBub2RlJ3MgaWRlbnRpZmllci4gQSBzdHJpbmcgb3IgbnVtYmVyIGlzIHByZWZlcnJlZC5cbiAgICAgKiBAcGFyYW0gW2RhdGFdIGFkZGl0aW9uYWwgZGF0YSBmb3IgdGhlIG5vZGUgYmVpbmcgYWRkZWQuIElmIG5vZGUgYWxyZWFkeVxuICAgICAqICAgZXhpc3RzIGl0cyBkYXRhIG9iamVjdCBpcyBhdWdtZW50ZWQgd2l0aCB0aGUgbmV3IG9uZS5cbiAgICAgKlxuICAgICAqIEByZXR1cm4ge25vZGV9IFRoZSBuZXdseSBhZGRlZCBub2RlIG9yIG5vZGUgd2l0aCBnaXZlbiBpZCBpZiBpdCBhbHJlYWR5IGV4aXN0cy5cbiAgICAgKi9cbiAgICBhZGROb2RlOiBhZGROb2RlLFxuXG4gICAgLyoqXG4gICAgICogQWRkcyBhIGxpbmsgdG8gdGhlIGdyYXBoLiBUaGUgZnVuY3Rpb24gYWx3YXlzIGNyZWF0ZSBhIG5ld1xuICAgICAqIGxpbmsgYmV0d2VlbiB0d28gbm9kZXMuIElmIG9uZSBvZiB0aGUgbm9kZXMgZG9lcyBub3QgZXhpc3RzXG4gICAgICogYSBuZXcgbm9kZSBpcyBjcmVhdGVkLlxuICAgICAqXG4gICAgICogQHBhcmFtIGZyb21JZCBsaW5rIHN0YXJ0IG5vZGUgaWQ7XG4gICAgICogQHBhcmFtIHRvSWQgbGluayBlbmQgbm9kZSBpZDtcbiAgICAgKiBAcGFyYW0gW2RhdGFdIGFkZGl0aW9uYWwgZGF0YSB0byBiZSBzZXQgb24gdGhlIG5ldyBsaW5rO1xuICAgICAqXG4gICAgICogQHJldHVybiB7bGlua30gVGhlIG5ld2x5IGNyZWF0ZWQgbGlua1xuICAgICAqL1xuICAgIGFkZExpbms6IGFkZExpbmssXG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmVzIGxpbmsgZnJvbSB0aGUgZ3JhcGguIElmIGxpbmsgZG9lcyBub3QgZXhpc3QgZG9lcyBub3RoaW5nLlxuICAgICAqXG4gICAgICogQHBhcmFtIGxpbmsgLSBvYmplY3QgcmV0dXJuZWQgYnkgYWRkTGluaygpIG9yIGdldExpbmtzKCkgbWV0aG9kcy5cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHRydWUgaWYgbGluayB3YXMgcmVtb3ZlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIHJlbW92ZUxpbms6IHJlbW92ZUxpbmssXG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmVzIG5vZGUgd2l0aCBnaXZlbiBpZCBmcm9tIHRoZSBncmFwaC4gSWYgbm9kZSBkb2VzIG5vdCBleGlzdCBpbiB0aGUgZ3JhcGhcbiAgICAgKiBkb2VzIG5vdGhpbmcuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbm9kZUlkIG5vZGUncyBpZGVudGlmaWVyIHBhc3NlZCB0byBhZGROb2RlKCkgZnVuY3Rpb24uXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB0cnVlIGlmIG5vZGUgd2FzIHJlbW92ZWQ7IGZhbHNlIG90aGVyd2lzZS5cbiAgICAgKi9cbiAgICByZW1vdmVOb2RlOiByZW1vdmVOb2RlLFxuXG4gICAgLyoqXG4gICAgICogR2V0cyBub2RlIHdpdGggZ2l2ZW4gaWRlbnRpZmllci4gSWYgbm9kZSBkb2VzIG5vdCBleGlzdCB1bmRlZmluZWQgdmFsdWUgaXMgcmV0dXJuZWQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbm9kZUlkIHJlcXVlc3RlZCBub2RlIGlkZW50aWZpZXI7XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtub2RlfSBpbiB3aXRoIHJlcXVlc3RlZCBpZGVudGlmaWVyIG9yIHVuZGVmaW5lZCBpZiBubyBzdWNoIG5vZGUgZXhpc3RzLlxuICAgICAqL1xuICAgIGdldE5vZGU6IGdldE5vZGUsXG5cbiAgICAvKipcbiAgICAgKiBHZXRzIG51bWJlciBvZiBub2RlcyBpbiB0aGlzIGdyYXBoLlxuICAgICAqXG4gICAgICogQHJldHVybiBudW1iZXIgb2Ygbm9kZXMgaW4gdGhlIGdyYXBoLlxuICAgICAqL1xuICAgIGdldE5vZGVzQ291bnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIG5vZGVzQ291bnQ7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEdldHMgdG90YWwgbnVtYmVyIG9mIGxpbmtzIGluIHRoZSBncmFwaC5cbiAgICAgKi9cbiAgICBnZXRMaW5rc0NvdW50OiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBsaW5rcy5sZW5ndGg7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEdldHMgYWxsIGxpbmtzIChpbmJvdW5kIGFuZCBvdXRib3VuZCkgZnJvbSB0aGUgbm9kZSB3aXRoIGdpdmVuIGlkLlxuICAgICAqIElmIG5vZGUgd2l0aCBnaXZlbiBpZCBpcyBub3QgZm91bmQgbnVsbCBpcyByZXR1cm5lZC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBub2RlSWQgcmVxdWVzdGVkIG5vZGUgaWRlbnRpZmllci5cbiAgICAgKlxuICAgICAqIEByZXR1cm4gQXJyYXkgb2YgbGlua3MgZnJvbSBhbmQgdG8gcmVxdWVzdGVkIG5vZGUgaWYgc3VjaCBub2RlIGV4aXN0cztcbiAgICAgKiAgIG90aGVyd2lzZSBudWxsIGlzIHJldHVybmVkLlxuICAgICAqL1xuICAgIGdldExpbmtzOiBnZXRMaW5rcyxcblxuICAgIC8qKlxuICAgICAqIEludm9rZXMgY2FsbGJhY2sgb24gZWFjaCBub2RlIG9mIHRoZSBncmFwaC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb24obm9kZSl9IGNhbGxiYWNrIEZ1bmN0aW9uIHRvIGJlIGludm9rZWQuIFRoZSBmdW5jdGlvblxuICAgICAqICAgaXMgcGFzc2VkIG9uZSBhcmd1bWVudDogdmlzaXRlZCBub2RlLlxuICAgICAqL1xuICAgIGZvckVhY2hOb2RlOiBmb3JFYWNoTm9kZSxcblxuICAgIC8qKlxuICAgICAqIEludm9rZXMgY2FsbGJhY2sgb24gZXZlcnkgbGlua2VkIChhZGphY2VudCkgbm9kZSB0byB0aGUgZ2l2ZW4gb25lLlxuICAgICAqXG4gICAgICogQHBhcmFtIG5vZGVJZCBJZGVudGlmaWVyIG9mIHRoZSByZXF1ZXN0ZWQgbm9kZS5cbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9uKG5vZGUsIGxpbmspfSBjYWxsYmFjayBGdW5jdGlvbiB0byBiZSBjYWxsZWQgb24gYWxsIGxpbmtlZCBub2Rlcy5cbiAgICAgKiAgIFRoZSBmdW5jdGlvbiBpcyBwYXNzZWQgdHdvIHBhcmFtZXRlcnM6IGFkamFjZW50IG5vZGUgYW5kIGxpbmsgb2JqZWN0IGl0c2VsZi5cbiAgICAgKiBAcGFyYW0gb3JpZW50ZWQgaWYgdHJ1ZSBncmFwaCB0cmVhdGVkIGFzIG9yaWVudGVkLlxuICAgICAqL1xuICAgIGZvckVhY2hMaW5rZWROb2RlOiBmb3JFYWNoTGlua2VkTm9kZSxcblxuICAgIC8qKlxuICAgICAqIEVudW1lcmF0ZXMgYWxsIGxpbmtzIGluIHRoZSBncmFwaFxuICAgICAqXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbihsaW5rKX0gY2FsbGJhY2sgRnVuY3Rpb24gdG8gYmUgY2FsbGVkIG9uIGFsbCBsaW5rcyBpbiB0aGUgZ3JhcGguXG4gICAgICogICBUaGUgZnVuY3Rpb24gaXMgcGFzc2VkIG9uZSBwYXJhbWV0ZXI6IGdyYXBoJ3MgbGluayBvYmplY3QuXG4gICAgICpcbiAgICAgKiBMaW5rIG9iamVjdCBjb250YWlucyBhdCBsZWFzdCB0aGUgZm9sbG93aW5nIGZpZWxkczpcbiAgICAgKiAgZnJvbUlkIC0gbm9kZSBpZCB3aGVyZSBsaW5rIHN0YXJ0cztcbiAgICAgKiAgdG9JZCAtIG5vZGUgaWQgd2hlcmUgbGluayBlbmRzLFxuICAgICAqICBkYXRhIC0gYWRkaXRpb25hbCBkYXRhIHBhc3NlZCB0byBncmFwaC5hZGRMaW5rKCkgbWV0aG9kLlxuICAgICAqL1xuICAgIGZvckVhY2hMaW5rOiBmb3JFYWNoTGluayxcblxuICAgIC8qKlxuICAgICAqIFN1c3BlbmQgYWxsIG5vdGlmaWNhdGlvbnMgYWJvdXQgZ3JhcGggY2hhbmdlcyB1bnRpbFxuICAgICAqIGVuZFVwZGF0ZSBpcyBjYWxsZWQuXG4gICAgICovXG4gICAgYmVnaW5VcGRhdGU6IGVudGVyTW9kaWZpY2F0aW9uLFxuXG4gICAgLyoqXG4gICAgICogUmVzdW1lcyBhbGwgbm90aWZpY2F0aW9ucyBhYm91dCBncmFwaCBjaGFuZ2VzIGFuZCBmaXJlc1xuICAgICAqIGdyYXBoICdjaGFuZ2VkJyBldmVudCBpbiBjYXNlIHRoZXJlIGFyZSBhbnkgcGVuZGluZyBjaGFuZ2VzLlxuICAgICAqL1xuICAgIGVuZFVwZGF0ZTogZXhpdE1vZGlmaWNhdGlvbixcblxuICAgIC8qKlxuICAgICAqIFJlbW92ZXMgYWxsIG5vZGVzIGFuZCBsaW5rcyBmcm9tIHRoZSBncmFwaC5cbiAgICAgKi9cbiAgICBjbGVhcjogY2xlYXIsXG5cbiAgICAvKipcbiAgICAgKiBEZXRlY3RzIHdoZXRoZXIgdGhlcmUgaXMgYSBsaW5rIGJldHdlZW4gdHdvIG5vZGVzLlxuICAgICAqIE9wZXJhdGlvbiBjb21wbGV4aXR5IGlzIE8obikgd2hlcmUgbiAtIG51bWJlciBvZiBsaW5rcyBvZiBhIG5vZGUuXG4gICAgICogTk9URTogdGhpcyBmdW5jdGlvbiBpcyBzeW5vbmltIGZvciBnZXRMaW5rKClcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIGxpbmsgaWYgdGhlcmUgaXMgb25lLiBudWxsIG90aGVyd2lzZS5cbiAgICAgKi9cbiAgICBoYXNMaW5rOiBnZXRMaW5rLFxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhbiBlZGdlIGJldHdlZW4gdHdvIG5vZGVzLlxuICAgICAqIE9wZXJhdGlvbiBjb21wbGV4aXR5IGlzIE8obikgd2hlcmUgbiAtIG51bWJlciBvZiBsaW5rcyBvZiBhIG5vZGUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZnJvbUlkIGxpbmsgc3RhcnQgaWRlbnRpZmllclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB0b0lkIGxpbmsgZW5kIGlkZW50aWZpZXJcbiAgICAgKlxuICAgICAqIEByZXR1cm5zIGxpbmsgaWYgdGhlcmUgaXMgb25lLiBudWxsIG90aGVyd2lzZS5cbiAgICAgKi9cbiAgICBnZXRMaW5rOiBnZXRMaW5rXG4gIH07XG5cbiAgLy8gdGhpcyB3aWxsIGFkZCBgb24oKWAgYW5kIGBmaXJlKClgIG1ldGhvZHMuXG4gIGV2ZW50aWZ5KGdyYXBoUGFydCk7XG5cbiAgbW9uaXRvclN1YnNjcmliZXJzKCk7XG5cbiAgcmV0dXJuIGdyYXBoUGFydDtcblxuICBmdW5jdGlvbiBtb25pdG9yU3Vic2NyaWJlcnMoKSB7XG4gICAgdmFyIHJlYWxPbiA9IGdyYXBoUGFydC5vbjtcblxuICAgIC8vIHJlcGxhY2UgcmVhbCBgb25gIHdpdGggb3VyIHRlbXBvcmFyeSBvbiwgd2hpY2ggd2lsbCB0cmlnZ2VyIGNoYW5nZVxuICAgIC8vIG1vZGlmaWNhdGlvbiBtb25pdG9yaW5nOlxuICAgIGdyYXBoUGFydC5vbiA9IG9uO1xuXG4gICAgZnVuY3Rpb24gb24oKSB7XG4gICAgICAvLyBub3cgaXQncyB0aW1lIHRvIHN0YXJ0IHRyYWNraW5nIHN0dWZmOlxuICAgICAgZ3JhcGhQYXJ0LmJlZ2luVXBkYXRlID0gZW50ZXJNb2RpZmljYXRpb24gPSBlbnRlck1vZGlmaWNhdGlvblJlYWw7XG4gICAgICBncmFwaFBhcnQuZW5kVXBkYXRlID0gZXhpdE1vZGlmaWNhdGlvbiA9IGV4aXRNb2RpZmljYXRpb25SZWFsO1xuICAgICAgcmVjb3JkTGlua0NoYW5nZSA9IHJlY29yZExpbmtDaGFuZ2VSZWFsO1xuICAgICAgcmVjb3JkTm9kZUNoYW5nZSA9IHJlY29yZE5vZGVDaGFuZ2VSZWFsO1xuXG4gICAgICAvLyB0aGlzIHdpbGwgcmVwbGFjZSBjdXJyZW50IGBvbmAgbWV0aG9kIHdpdGggcmVhbCBwdWIvc3ViIGZyb20gYGV2ZW50aWZ5YC5cbiAgICAgIGdyYXBoUGFydC5vbiA9IHJlYWxPbjtcbiAgICAgIC8vIGRlbGVnYXRlIHRvIHJlYWwgYG9uYCBoYW5kbGVyOlxuICAgICAgcmV0dXJuIHJlYWxPbi5hcHBseShncmFwaFBhcnQsIGFyZ3VtZW50cyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcmVjb3JkTGlua0NoYW5nZVJlYWwobGluaywgY2hhbmdlVHlwZSkge1xuICAgIGNoYW5nZXMucHVzaCh7XG4gICAgICBsaW5rOiBsaW5rLFxuICAgICAgY2hhbmdlVHlwZTogY2hhbmdlVHlwZVxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVjb3JkTm9kZUNoYW5nZVJlYWwobm9kZSwgY2hhbmdlVHlwZSkge1xuICAgIGNoYW5nZXMucHVzaCh7XG4gICAgICBub2RlOiBub2RlLFxuICAgICAgY2hhbmdlVHlwZTogY2hhbmdlVHlwZVxuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gYWRkTm9kZShub2RlSWQsIGRhdGEpIHtcbiAgICBpZiAobm9kZUlkID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBub2RlIGlkZW50aWZpZXInKTtcbiAgICB9XG5cbiAgICBlbnRlck1vZGlmaWNhdGlvbigpO1xuXG4gICAgdmFyIG5vZGUgPSBnZXROb2RlKG5vZGVJZCk7XG4gICAgaWYgKCFub2RlKSB7XG4gICAgICBub2RlID0gbmV3IE5vZGUobm9kZUlkKTtcbiAgICAgIG5vZGVzQ291bnQrKztcbiAgICAgIHJlY29yZE5vZGVDaGFuZ2Uobm9kZSwgJ2FkZCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZWNvcmROb2RlQ2hhbmdlKG5vZGUsICd1cGRhdGUnKTtcbiAgICB9XG5cbiAgICBub2RlLmRhdGEgPSBkYXRhO1xuXG4gICAgbm9kZXNbbm9kZUlkXSA9IG5vZGU7XG5cbiAgICBleGl0TW9kaWZpY2F0aW9uKCk7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBmdW5jdGlvbiBnZXROb2RlKG5vZGVJZCkge1xuICAgIHJldHVybiBub2Rlc1tub2RlSWRdO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVtb3ZlTm9kZShub2RlSWQpIHtcbiAgICB2YXIgbm9kZSA9IGdldE5vZGUobm9kZUlkKTtcbiAgICBpZiAoIW5vZGUpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBlbnRlck1vZGlmaWNhdGlvbigpO1xuXG4gICAgaWYgKG5vZGUubGlua3MpIHtcbiAgICAgIHdoaWxlIChub2RlLmxpbmtzLmxlbmd0aCkge1xuICAgICAgICB2YXIgbGluayA9IG5vZGUubGlua3NbMF07XG4gICAgICAgIHJlbW92ZUxpbmsobGluayk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZGVsZXRlIG5vZGVzW25vZGVJZF07XG4gICAgbm9kZXNDb3VudC0tO1xuXG4gICAgcmVjb3JkTm9kZUNoYW5nZShub2RlLCAncmVtb3ZlJyk7XG5cbiAgICBleGl0TW9kaWZpY2F0aW9uKCk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG5cbiAgZnVuY3Rpb24gYWRkTGluayhmcm9tSWQsIHRvSWQsIGRhdGEpIHtcbiAgICBlbnRlck1vZGlmaWNhdGlvbigpO1xuXG4gICAgdmFyIGZyb21Ob2RlID0gZ2V0Tm9kZShmcm9tSWQpIHx8IGFkZE5vZGUoZnJvbUlkKTtcbiAgICB2YXIgdG9Ob2RlID0gZ2V0Tm9kZSh0b0lkKSB8fCBhZGROb2RlKHRvSWQpO1xuXG4gICAgdmFyIGxpbmsgPSBjcmVhdGVMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSk7XG5cbiAgICBsaW5rcy5wdXNoKGxpbmspO1xuXG4gICAgLy8gVE9ETzogdGhpcyBpcyBub3QgY29vbC4gT24gbGFyZ2UgZ3JhcGhzIHBvdGVudGlhbGx5IHdvdWxkIGNvbnN1bWUgbW9yZSBtZW1vcnkuXG4gICAgYWRkTGlua1RvTm9kZShmcm9tTm9kZSwgbGluayk7XG4gICAgaWYgKGZyb21JZCAhPT0gdG9JZCkge1xuICAgICAgLy8gbWFrZSBzdXJlIHdlIGFyZSBub3QgZHVwbGljYXRpbmcgbGlua3MgZm9yIHNlbGYtbG9vcHNcbiAgICAgIGFkZExpbmtUb05vZGUodG9Ob2RlLCBsaW5rKTtcbiAgICB9XG5cbiAgICByZWNvcmRMaW5rQ2hhbmdlKGxpbmssICdhZGQnKTtcblxuICAgIGV4aXRNb2RpZmljYXRpb24oKTtcblxuICAgIHJldHVybiBsaW5rO1xuICB9XG5cbiAgZnVuY3Rpb24gY3JlYXRlU2luZ2xlTGluayhmcm9tSWQsIHRvSWQsIGRhdGEpIHtcbiAgICB2YXIgbGlua0lkID0gbWFrZUxpbmtJZChmcm9tSWQsIHRvSWQpO1xuICAgIHJldHVybiBuZXcgTGluayhmcm9tSWQsIHRvSWQsIGRhdGEsIGxpbmtJZCk7XG4gIH1cblxuICBmdW5jdGlvbiBjcmVhdGVVbmlxdWVMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSkge1xuICAgIC8vIFRPRE86IEdldCByaWQgb2YgdGhpcyBtZXRob2QuXG4gICAgdmFyIGxpbmtJZCA9IG1ha2VMaW5rSWQoZnJvbUlkLCB0b0lkKTtcbiAgICB2YXIgaXNNdWx0aUVkZ2UgPSBtdWx0aUVkZ2VzLmhhc093blByb3BlcnR5KGxpbmtJZCk7XG4gICAgaWYgKGlzTXVsdGlFZGdlIHx8IGdldExpbmsoZnJvbUlkLCB0b0lkKSkge1xuICAgICAgaWYgKCFpc011bHRpRWRnZSkge1xuICAgICAgICBtdWx0aUVkZ2VzW2xpbmtJZF0gPSAwO1xuICAgICAgfVxuICAgICAgdmFyIHN1ZmZpeCA9ICdAJyArICgrK211bHRpRWRnZXNbbGlua0lkXSk7XG4gICAgICBsaW5rSWQgPSBtYWtlTGlua0lkKGZyb21JZCArIHN1ZmZpeCwgdG9JZCArIHN1ZmZpeCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSwgbGlua0lkKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldExpbmtzKG5vZGVJZCkge1xuICAgIHZhciBub2RlID0gZ2V0Tm9kZShub2RlSWQpO1xuICAgIHJldHVybiBub2RlID8gbm9kZS5saW5rcyA6IG51bGw7XG4gIH1cblxuICBmdW5jdGlvbiByZW1vdmVMaW5rKGxpbmspIHtcbiAgICBpZiAoIWxpbmspIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdmFyIGlkeCA9IGluZGV4T2ZFbGVtZW50SW5BcnJheShsaW5rLCBsaW5rcyk7XG4gICAgaWYgKGlkeCA8IDApIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBlbnRlck1vZGlmaWNhdGlvbigpO1xuXG4gICAgbGlua3Muc3BsaWNlKGlkeCwgMSk7XG5cbiAgICB2YXIgZnJvbU5vZGUgPSBnZXROb2RlKGxpbmsuZnJvbUlkKTtcbiAgICB2YXIgdG9Ob2RlID0gZ2V0Tm9kZShsaW5rLnRvSWQpO1xuXG4gICAgaWYgKGZyb21Ob2RlKSB7XG4gICAgICBpZHggPSBpbmRleE9mRWxlbWVudEluQXJyYXkobGluaywgZnJvbU5vZGUubGlua3MpO1xuICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgIGZyb21Ob2RlLmxpbmtzLnNwbGljZShpZHgsIDEpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0b05vZGUpIHtcbiAgICAgIGlkeCA9IGluZGV4T2ZFbGVtZW50SW5BcnJheShsaW5rLCB0b05vZGUubGlua3MpO1xuICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgIHRvTm9kZS5saW5rcy5zcGxpY2UoaWR4LCAxKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZWNvcmRMaW5rQ2hhbmdlKGxpbmssICdyZW1vdmUnKTtcblxuICAgIGV4aXRNb2RpZmljYXRpb24oKTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0TGluayhmcm9tTm9kZUlkLCB0b05vZGVJZCkge1xuICAgIC8vIFRPRE86IFVzZSBzb3J0ZWQgbGlua3MgdG8gc3BlZWQgdGhpcyB1cFxuICAgIHZhciBub2RlID0gZ2V0Tm9kZShmcm9tTm9kZUlkKSxcbiAgICAgIGk7XG4gICAgaWYgKCFub2RlIHx8ICFub2RlLmxpbmtzKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbm9kZS5saW5rcy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGxpbmsgPSBub2RlLmxpbmtzW2ldO1xuICAgICAgaWYgKGxpbmsuZnJvbUlkID09PSBmcm9tTm9kZUlkICYmIGxpbmsudG9JZCA9PT0gdG9Ob2RlSWQpIHtcbiAgICAgICAgcmV0dXJuIGxpbms7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7IC8vIG5vIGxpbmsuXG4gIH1cblxuICBmdW5jdGlvbiBjbGVhcigpIHtcbiAgICBlbnRlck1vZGlmaWNhdGlvbigpO1xuICAgIGZvckVhY2hOb2RlKGZ1bmN0aW9uKG5vZGUpIHtcbiAgICAgIHJlbW92ZU5vZGUobm9kZS5pZCk7XG4gICAgfSk7XG4gICAgZXhpdE1vZGlmaWNhdGlvbigpO1xuICB9XG5cbiAgZnVuY3Rpb24gZm9yRWFjaExpbmsoY2FsbGJhY2spIHtcbiAgICB2YXIgaSwgbGVuZ3RoO1xuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGZvciAoaSA9IDAsIGxlbmd0aCA9IGxpbmtzLmxlbmd0aDsgaSA8IGxlbmd0aDsgKytpKSB7XG4gICAgICAgIGNhbGxiYWNrKGxpbmtzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBmb3JFYWNoTGlua2VkTm9kZShub2RlSWQsIGNhbGxiYWNrLCBvcmllbnRlZCkge1xuICAgIHZhciBub2RlID0gZ2V0Tm9kZShub2RlSWQpO1xuXG4gICAgaWYgKG5vZGUgJiYgbm9kZS5saW5rcyAmJiB0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChvcmllbnRlZCkge1xuICAgICAgICByZXR1cm4gZm9yRWFjaE9yaWVudGVkTGluayhub2RlLmxpbmtzLCBub2RlSWQsIGNhbGxiYWNrKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBmb3JFYWNoTm9uT3JpZW50ZWRMaW5rKG5vZGUubGlua3MsIG5vZGVJZCwgY2FsbGJhY2spO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZvckVhY2hOb25PcmllbnRlZExpbmsobGlua3MsIG5vZGVJZCwgY2FsbGJhY2spIHtcbiAgICB2YXIgcXVpdEZhc3Q7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5rcy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGxpbmsgPSBsaW5rc1tpXTtcbiAgICAgIHZhciBsaW5rZWROb2RlSWQgPSBsaW5rLmZyb21JZCA9PT0gbm9kZUlkID8gbGluay50b0lkIDogbGluay5mcm9tSWQ7XG5cbiAgICAgIHF1aXRGYXN0ID0gY2FsbGJhY2sobm9kZXNbbGlua2VkTm9kZUlkXSwgbGluayk7XG4gICAgICBpZiAocXVpdEZhc3QpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7IC8vIENsaWVudCBkb2VzIG5vdCBuZWVkIG1vcmUgaXRlcmF0aW9ucy4gQnJlYWsgbm93LlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZvckVhY2hPcmllbnRlZExpbmsobGlua3MsIG5vZGVJZCwgY2FsbGJhY2spIHtcbiAgICB2YXIgcXVpdEZhc3Q7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsaW5rcy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGxpbmsgPSBsaW5rc1tpXTtcbiAgICAgIGlmIChsaW5rLmZyb21JZCA9PT0gbm9kZUlkKSB7XG4gICAgICAgIHF1aXRGYXN0ID0gY2FsbGJhY2sobm9kZXNbbGluay50b0lkXSwgbGluayk7XG4gICAgICAgIGlmIChxdWl0RmFzdCkge1xuICAgICAgICAgIHJldHVybiB0cnVlOyAvLyBDbGllbnQgZG9lcyBub3QgbmVlZCBtb3JlIGl0ZXJhdGlvbnMuIEJyZWFrIG5vdy5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIHdlIHdpbGwgbm90IGZpcmUgYW55dGhpbmcgdW50aWwgdXNlcnMgb2YgdGhpcyBsaWJyYXJ5IGV4cGxpY2l0bHkgY2FsbCBgb24oKWBcbiAgLy8gbWV0aG9kLlxuICBmdW5jdGlvbiBub29wKCkge31cblxuICAvLyBFbnRlciwgRXhpdCBtb2RpZmljYXRpb24gYWxsb3dzIGJ1bGsgZ3JhcGggdXBkYXRlcyB3aXRob3V0IGZpcmluZyBldmVudHMuXG4gIGZ1bmN0aW9uIGVudGVyTW9kaWZpY2F0aW9uUmVhbCgpIHtcbiAgICBzdXNwZW5kRXZlbnRzICs9IDE7XG4gIH1cblxuICBmdW5jdGlvbiBleGl0TW9kaWZpY2F0aW9uUmVhbCgpIHtcbiAgICBzdXNwZW5kRXZlbnRzIC09IDE7XG4gICAgaWYgKHN1c3BlbmRFdmVudHMgPT09IDAgJiYgY2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gICAgICBncmFwaFBhcnQuZmlyZSgnY2hhbmdlZCcsIGNoYW5nZXMpO1xuICAgICAgY2hhbmdlcy5sZW5ndGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGNyZWF0ZU5vZGVJdGVyYXRvcigpIHtcbiAgICAvLyBPYmplY3Qua2V5cyBpdGVyYXRvciBpcyAxLjN4IGZhc3RlciB0aGFuIGBmb3IgaW5gIGxvb3AuXG4gICAgLy8gU2VlIGBodHRwczovL2dpdGh1Yi5jb20vYW52YWthL25ncmFwaC5ncmFwaC90cmVlL2JlbmNoLWZvci1pbi12cy1vYmota2V5c2BcbiAgICAvLyBicmFuY2ggZm9yIHBlcmYgdGVzdFxuICAgIHJldHVybiBPYmplY3Qua2V5cyA/IG9iamVjdEtleXNJdGVyYXRvciA6IGZvckluSXRlcmF0b3I7XG4gIH1cblxuICBmdW5jdGlvbiBvYmplY3RLZXlzSXRlcmF0b3IoY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhub2Rlcyk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBrZXlzLmxlbmd0aDsgKytpKSB7XG4gICAgICBpZiAoY2FsbGJhY2sobm9kZXNba2V5c1tpXV0pKSB7XG4gICAgICAgIHJldHVybiB0cnVlOyAvLyBjbGllbnQgZG9lc24ndCB3YW50IHRvIHByb2NlZWQuIFJldHVybi5cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBmb3JJbkl0ZXJhdG9yKGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgbm9kZTtcblxuICAgIGZvciAobm9kZSBpbiBub2Rlcykge1xuICAgICAgaWYgKGNhbGxiYWNrKG5vZGVzW25vZGVdKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTsgLy8gY2xpZW50IGRvZXNuJ3Qgd2FudCB0byBwcm9jZWVkLiBSZXR1cm4uXG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8vIG5lZWQgdGhpcyBmb3Igb2xkIGJyb3dzZXJzLiBTaG91bGQgdGhpcyBiZSBhIHNlcGFyYXRlIG1vZHVsZT9cbmZ1bmN0aW9uIGluZGV4T2ZFbGVtZW50SW5BcnJheShlbGVtZW50LCBhcnJheSkge1xuICBpZiAoIWFycmF5KSByZXR1cm4gLTE7XG5cbiAgaWYgKGFycmF5LmluZGV4T2YpIHtcbiAgICByZXR1cm4gYXJyYXkuaW5kZXhPZihlbGVtZW50KTtcbiAgfVxuXG4gIHZhciBsZW4gPSBhcnJheS5sZW5ndGgsXG4gICAgaTtcblxuICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICBpZiAoYXJyYXlbaV0gPT09IGVsZW1lbnQpIHtcbiAgICAgIHJldHVybiBpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiAtMTtcbn1cblxuLyoqXG4gKiBJbnRlcm5hbCBzdHJ1Y3R1cmUgdG8gcmVwcmVzZW50IG5vZGU7XG4gKi9cbmZ1bmN0aW9uIE5vZGUoaWQpIHtcbiAgdGhpcy5pZCA9IGlkO1xuICB0aGlzLmxpbmtzID0gbnVsbDtcbiAgdGhpcy5kYXRhID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gYWRkTGlua1RvTm9kZShub2RlLCBsaW5rKSB7XG4gIGlmIChub2RlLmxpbmtzKSB7XG4gICAgbm9kZS5saW5rcy5wdXNoKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIG5vZGUubGlua3MgPSBbbGlua107XG4gIH1cbn1cblxuLyoqXG4gKiBJbnRlcm5hbCBzdHJ1Y3R1cmUgdG8gcmVwcmVzZW50IGxpbmtzO1xuICovXG5mdW5jdGlvbiBMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSwgaWQpIHtcbiAgdGhpcy5mcm9tSWQgPSBmcm9tSWQ7XG4gIHRoaXMudG9JZCA9IHRvSWQ7XG4gIHRoaXMuZGF0YSA9IGRhdGE7XG4gIHRoaXMuaWQgPSBpZDtcbn1cblxuZnVuY3Rpb24gaGFzaENvZGUoc3RyKSB7XG4gIHZhciBoYXNoID0gMCwgaSwgY2hyLCBsZW47XG4gIGlmIChzdHIubGVuZ3RoID09IDApIHJldHVybiBoYXNoO1xuICBmb3IgKGkgPSAwLCBsZW4gPSBzdHIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICBjaHIgICA9IHN0ci5jaGFyQ29kZUF0KGkpO1xuICAgIGhhc2ggID0gKChoYXNoIDw8IDUpIC0gaGFzaCkgKyBjaHI7XG4gICAgaGFzaCB8PSAwOyAvLyBDb252ZXJ0IHRvIDMyYml0IGludGVnZXJcbiAgfVxuICByZXR1cm4gaGFzaDtcbn1cblxuZnVuY3Rpb24gbWFrZUxpbmtJZChmcm9tSWQsIHRvSWQpIHtcbiAgcmV0dXJuIGhhc2hDb2RlKGZyb21JZC50b1N0cmluZygpICsgJ/CfkYkgJyArIHRvSWQudG9TdHJpbmcoKSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IG1lcmdlO1xuXG4vKipcbiAqIEF1Z21lbnRzIGB0YXJnZXRgIHdpdGggcHJvcGVydGllcyBpbiBgb3B0aW9uc2AuIERvZXMgbm90IG92ZXJyaWRlXG4gKiB0YXJnZXQncyBwcm9wZXJ0aWVzIGlmIHRoZXkgYXJlIGRlZmluZWQgYW5kIG1hdGNoZXMgZXhwZWN0ZWQgdHlwZSBpbiBcbiAqIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBtZXJnZWQgb2JqZWN0XG4gKi9cbmZ1bmN0aW9uIG1lcmdlKHRhcmdldCwgb3B0aW9ucykge1xuICB2YXIga2V5O1xuICBpZiAoIXRhcmdldCkgeyB0YXJnZXQgPSB7fTsgfVxuICBpZiAob3B0aW9ucykge1xuICAgIGZvciAoa2V5IGluIG9wdGlvbnMpIHtcbiAgICAgIGlmIChvcHRpb25zLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgdmFyIHRhcmdldEhhc0l0ID0gdGFyZ2V0Lmhhc093blByb3BlcnR5KGtleSksXG4gICAgICAgICAgICBvcHRpb25zVmFsdWVUeXBlID0gdHlwZW9mIG9wdGlvbnNba2V5XSxcbiAgICAgICAgICAgIHNob3VsZFJlcGxhY2UgPSAhdGFyZ2V0SGFzSXQgfHwgKHR5cGVvZiB0YXJnZXRba2V5XSAhPT0gb3B0aW9uc1ZhbHVlVHlwZSk7XG5cbiAgICAgICAgaWYgKHNob3VsZFJlcGxhY2UpIHtcbiAgICAgICAgICB0YXJnZXRba2V5XSA9IG9wdGlvbnNba2V5XTtcbiAgICAgICAgfSBlbHNlIGlmIChvcHRpb25zVmFsdWVUeXBlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIC8vIGdvIGRlZXAsIGRvbid0IGNhcmUgYWJvdXQgbG9vcHMgaGVyZSwgd2UgYXJlIHNpbXBsZSBBUEkhOlxuICAgICAgICAgIHRhcmdldFtrZXldID0gbWVyZ2UodGFyZ2V0W2tleV0sIG9wdGlvbnNba2V5XSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gIEJvZHk6IEJvZHksXG4gIFZlY3RvcjJkOiBWZWN0b3IyZCxcbiAgQm9keTNkOiBCb2R5M2QsXG4gIFZlY3RvcjNkOiBWZWN0b3IzZFxufTtcblxuZnVuY3Rpb24gQm9keSh4LCB5KSB7XG4gIHRoaXMucG9zID0gbmV3IFZlY3RvcjJkKHgsIHkpO1xuICB0aGlzLnByZXZQb3MgPSBuZXcgVmVjdG9yMmQoeCwgeSk7XG4gIHRoaXMuZm9yY2UgPSBuZXcgVmVjdG9yMmQoKTtcbiAgdGhpcy52ZWxvY2l0eSA9IG5ldyBWZWN0b3IyZCgpO1xuICB0aGlzLm1hc3MgPSAxO1xufVxuXG5Cb2R5LnByb3RvdHlwZS5zZXRQb3NpdGlvbiA9IGZ1bmN0aW9uICh4LCB5KSB7XG4gIHRoaXMucHJldlBvcy54ID0gdGhpcy5wb3MueCA9IHg7XG4gIHRoaXMucHJldlBvcy55ID0gdGhpcy5wb3MueSA9IHk7XG59O1xuXG5mdW5jdGlvbiBWZWN0b3IyZCh4LCB5KSB7XG4gIGlmICh4ICYmIHR5cGVvZiB4ICE9PSAnbnVtYmVyJykge1xuICAgIC8vIGNvdWxkIGJlIGFub3RoZXIgdmVjdG9yXG4gICAgdGhpcy54ID0gdHlwZW9mIHgueCA9PT0gJ251bWJlcicgPyB4LnggOiAwO1xuICAgIHRoaXMueSA9IHR5cGVvZiB4LnkgPT09ICdudW1iZXInID8geC55IDogMDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSB0eXBlb2YgeCA9PT0gJ251bWJlcicgPyB4IDogMDtcbiAgICB0aGlzLnkgPSB0eXBlb2YgeSA9PT0gJ251bWJlcicgPyB5IDogMDtcbiAgfVxufVxuXG5WZWN0b3IyZC5wcm90b3R5cGUucmVzZXQgPSBmdW5jdGlvbiAoKSB7XG4gIHRoaXMueCA9IHRoaXMueSA9IDA7XG59O1xuXG5mdW5jdGlvbiBCb2R5M2QoeCwgeSwgeikge1xuICB0aGlzLnBvcyA9IG5ldyBWZWN0b3IzZCh4LCB5LCB6KTtcbiAgdGhpcy5wcmV2UG9zID0gbmV3IFZlY3RvcjNkKHgsIHksIHopO1xuICB0aGlzLmZvcmNlID0gbmV3IFZlY3RvcjNkKCk7XG4gIHRoaXMudmVsb2NpdHkgPSBuZXcgVmVjdG9yM2QoKTtcbiAgdGhpcy5tYXNzID0gMTtcbn1cblxuQm9keTNkLnByb3RvdHlwZS5zZXRQb3NpdGlvbiA9IGZ1bmN0aW9uICh4LCB5LCB6KSB7XG4gIHRoaXMucHJldlBvcy54ID0gdGhpcy5wb3MueCA9IHg7XG4gIHRoaXMucHJldlBvcy55ID0gdGhpcy5wb3MueSA9IHk7XG4gIHRoaXMucHJldlBvcy56ID0gdGhpcy5wb3MueiA9IHo7XG59O1xuXG5mdW5jdGlvbiBWZWN0b3IzZCh4LCB5LCB6KSB7XG4gIGlmICh4ICYmIHR5cGVvZiB4ICE9PSAnbnVtYmVyJykge1xuICAgIC8vIGNvdWxkIGJlIGFub3RoZXIgdmVjdG9yXG4gICAgdGhpcy54ID0gdHlwZW9mIHgueCA9PT0gJ251bWJlcicgPyB4LnggOiAwO1xuICAgIHRoaXMueSA9IHR5cGVvZiB4LnkgPT09ICdudW1iZXInID8geC55IDogMDtcbiAgICB0aGlzLnogPSB0eXBlb2YgeC56ID09PSAnbnVtYmVyJyA/IHgueiA6IDA7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy54ID0gdHlwZW9mIHggPT09ICdudW1iZXInID8geCA6IDA7XG4gICAgdGhpcy55ID0gdHlwZW9mIHkgPT09ICdudW1iZXInID8geSA6IDA7XG4gICAgdGhpcy56ID0gdHlwZW9mIHogPT09ICdudW1iZXInID8geiA6IDA7XG4gIH1cbn07XG5cblZlY3RvcjNkLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy54ID0gdGhpcy55ID0gdGhpcy56ID0gMDtcbn07XG4iLCIvKipcbiAqIFRoaXMgaXMgQmFybmVzIEh1dCBzaW11bGF0aW9uIGFsZ29yaXRobSBmb3IgM2QgY2FzZS4gSW1wbGVtZW50YXRpb25cbiAqIGlzIGhpZ2hseSBvcHRpbWl6ZWQgKGF2b2lkcyByZWN1c2lvbiBhbmQgZ2MgcHJlc3N1cmUpXG4gKlxuICogaHR0cDovL3d3dy5jcy5wcmluY2V0b24uZWR1L2NvdXJzZXMvYXJjaGl2ZS9mYWxsMDMvY3MxMjYvYXNzaWdubWVudHMvYmFybmVzLWh1dC5odG1sXG4gKlxuICogTk9URTogVGhpcyBtb2R1bGUgZHVwbGljYXRlcyBhIGxvdCBvZiBjb2RlIGZyb20gMmQgY2FzZS4gUHJpbWFyeSByZWFzb24gZm9yXG4gKiB0aGlzIGlzIHBlcmZvcm1hbmNlLiBFdmVyeSB0aW1lIEkgdHJpZWQgdG8gYWJzdHJhY3QgYXdheSB2ZWN0b3Igb3BlcmF0aW9uc1xuICogSSBoYWQgbmVnYXRpdmUgaW1wYWN0IG9uIHBlcmZvcm1hbmNlLiBTbyBpbiB0aGlzIGNhc2UgSSdtIHNjYXJpZnlpbmcgY29kZVxuICogcmV1c2UgaW4gZmF2b3Igb2Ygc3BlZWRcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIG9wdGlvbnMuZ3Jhdml0eSA9IHR5cGVvZiBvcHRpb25zLmdyYXZpdHkgPT09ICdudW1iZXInID8gb3B0aW9ucy5ncmF2aXR5IDogLTE7XG4gIG9wdGlvbnMudGhldGEgPSB0eXBlb2Ygb3B0aW9ucy50aGV0YSA9PT0gJ251bWJlcicgPyBvcHRpb25zLnRoZXRhIDogMC44O1xuXG4gIC8vIHdlIHJlcXVpcmUgZGV0ZXJtaW5pc3RpYyByYW5kb21uZXNzIGhlcmVcbiAgdmFyIHJhbmRvbSA9IHJlcXVpcmUoJ25ncmFwaC5yYW5kb20nKS5yYW5kb20oMTk4NCksXG4gICAgTm9kZSA9IHJlcXVpcmUoJy4vbm9kZScpLFxuICAgIEluc2VydFN0YWNrID0gcmVxdWlyZSgnLi9pbnNlcnRTdGFjaycpLFxuICAgIGlzU2FtZVBvc2l0aW9uID0gcmVxdWlyZSgnLi9pc1NhbWVQb3NpdGlvbicpO1xuXG4gIHZhciBncmF2aXR5ID0gb3B0aW9ucy5ncmF2aXR5LFxuICAgIHVwZGF0ZVF1ZXVlID0gW10sXG4gICAgaW5zZXJ0U3RhY2sgPSBuZXcgSW5zZXJ0U3RhY2soKSxcbiAgICB0aGV0YSA9IG9wdGlvbnMudGhldGEsXG5cbiAgICBub2Rlc0NhY2hlID0gW10sXG4gICAgY3VycmVudEluQ2FjaGUgPSAwLFxuICAgIG5ld05vZGUgPSBmdW5jdGlvbigpIHtcbiAgICAgIC8vIFRvIGF2b2lkIHByZXNzdXJlIG9uIEdDIHdlIHJldXNlIG5vZGVzLlxuICAgICAgdmFyIG5vZGUgPSBub2Rlc0NhY2hlW2N1cnJlbnRJbkNhY2hlXTtcbiAgICAgIGlmIChub2RlKSB7XG4gICAgICAgIG5vZGUucXVhZDAgPSBudWxsO1xuICAgICAgICBub2RlLnF1YWQ0ID0gbnVsbDtcbiAgICAgICAgbm9kZS5xdWFkMSA9IG51bGw7XG4gICAgICAgIG5vZGUucXVhZDUgPSBudWxsO1xuICAgICAgICBub2RlLnF1YWQyID0gbnVsbDtcbiAgICAgICAgbm9kZS5xdWFkNiA9IG51bGw7XG4gICAgICAgIG5vZGUucXVhZDMgPSBudWxsO1xuICAgICAgICBub2RlLnF1YWQ3ID0gbnVsbDtcbiAgICAgICAgbm9kZS5ib2R5ID0gbnVsbDtcbiAgICAgICAgbm9kZS5tYXNzID0gbm9kZS5tYXNzWCA9IG5vZGUubWFzc1kgPSBub2RlLm1hc3NaID0gMDtcbiAgICAgICAgbm9kZS5sZWZ0ID0gbm9kZS5yaWdodCA9IG5vZGUudG9wID0gbm9kZS5ib3R0b20gPSBub2RlLmZyb250ID0gbm9kZS5iYWNrID0gMDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5vZGUgPSBuZXcgTm9kZSgpO1xuICAgICAgICBub2Rlc0NhY2hlW2N1cnJlbnRJbkNhY2hlXSA9IG5vZGU7XG4gICAgICB9XG5cbiAgICAgICsrY3VycmVudEluQ2FjaGU7XG4gICAgICByZXR1cm4gbm9kZTtcbiAgICB9LFxuXG4gICAgcm9vdCA9IG5ld05vZGUoKSxcblxuICAgIC8vIEluc2VydHMgYm9keSB0byB0aGUgdHJlZVxuICAgIGluc2VydCA9IGZ1bmN0aW9uKG5ld0JvZHkpIHtcbiAgICAgIGluc2VydFN0YWNrLnJlc2V0KCk7XG4gICAgICBpbnNlcnRTdGFjay5wdXNoKHJvb3QsIG5ld0JvZHkpO1xuXG4gICAgICB3aGlsZSAoIWluc2VydFN0YWNrLmlzRW1wdHkoKSkge1xuICAgICAgICB2YXIgc3RhY2tJdGVtID0gaW5zZXJ0U3RhY2sucG9wKCksXG4gICAgICAgICAgbm9kZSA9IHN0YWNrSXRlbS5ub2RlLFxuICAgICAgICAgIGJvZHkgPSBzdGFja0l0ZW0uYm9keTtcblxuICAgICAgICBpZiAoIW5vZGUuYm9keSkge1xuICAgICAgICAgIC8vIFRoaXMgaXMgaW50ZXJuYWwgbm9kZS4gVXBkYXRlIHRoZSB0b3RhbCBtYXNzIG9mIHRoZSBub2RlIGFuZCBjZW50ZXItb2YtbWFzcy5cbiAgICAgICAgICB2YXIgeCA9IGJvZHkucG9zLng7XG4gICAgICAgICAgdmFyIHkgPSBib2R5LnBvcy55O1xuICAgICAgICAgIHZhciB6ID0gYm9keS5wb3MuejtcbiAgICAgICAgICBub2RlLm1hc3MgKz0gYm9keS5tYXNzO1xuICAgICAgICAgIG5vZGUubWFzc1ggKz0gYm9keS5tYXNzICogeDtcbiAgICAgICAgICBub2RlLm1hc3NZICs9IGJvZHkubWFzcyAqIHk7XG4gICAgICAgICAgbm9kZS5tYXNzWiArPSBib2R5Lm1hc3MgKiB6O1xuXG4gICAgICAgICAgLy8gUmVjdXJzaXZlbHkgaW5zZXJ0IHRoZSBib2R5IGluIHRoZSBhcHByb3ByaWF0ZSBxdWFkcmFudC5cbiAgICAgICAgICAvLyBCdXQgZmlyc3QgZmluZCB0aGUgYXBwcm9wcmlhdGUgcXVhZHJhbnQuXG4gICAgICAgICAgdmFyIHF1YWRJZHggPSAwLCAvLyBBc3N1bWUgd2UgYXJlIGluIHRoZSAwJ3MgcXVhZC5cbiAgICAgICAgICAgIGxlZnQgPSBub2RlLmxlZnQsXG4gICAgICAgICAgICByaWdodCA9IChub2RlLnJpZ2h0ICsgbGVmdCkgLyAyLFxuICAgICAgICAgICAgdG9wID0gbm9kZS50b3AsXG4gICAgICAgICAgICBib3R0b20gPSAobm9kZS5ib3R0b20gKyB0b3ApIC8gMixcbiAgICAgICAgICAgIGJhY2sgPSBub2RlLmJhY2ssXG4gICAgICAgICAgICBmcm9udCA9IChub2RlLmZyb250ICsgYmFjaykgLyAyO1xuXG4gICAgICAgICAgaWYgKHggPiByaWdodCkgeyAvLyBzb21ld2hlcmUgaW4gdGhlIGVhc3Rlcm4gcGFydC5cbiAgICAgICAgICAgIHF1YWRJZHggKz0gMTtcbiAgICAgICAgICAgIHZhciBvbGRMZWZ0ID0gbGVmdDtcbiAgICAgICAgICAgIGxlZnQgPSByaWdodDtcbiAgICAgICAgICAgIHJpZ2h0ID0gcmlnaHQgKyAocmlnaHQgLSBvbGRMZWZ0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHkgPiBib3R0b20pIHsgLy8gYW5kIGluIHNvdXRoLlxuICAgICAgICAgICAgcXVhZElkeCArPSAyO1xuICAgICAgICAgICAgdmFyIG9sZFRvcCA9IHRvcDtcbiAgICAgICAgICAgIHRvcCA9IGJvdHRvbTtcbiAgICAgICAgICAgIGJvdHRvbSA9IGJvdHRvbSArIChib3R0b20gLSBvbGRUb3ApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoeiA+IGZyb250KSB7IC8vIGFuZCBpbiBmcm9udGFsIHBhcnRcbiAgICAgICAgICAgIHF1YWRJZHggKz0gNDtcbiAgICAgICAgICAgIHZhciBvbGRCYWNrID0gYmFjaztcbiAgICAgICAgICAgIGJhY2sgPSBmcm9udDtcbiAgICAgICAgICAgIGZyb250ID0gYmFjayArIChiYWNrIC0gb2xkQmFjayk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdmFyIGNoaWxkID0gZ2V0Q2hpbGQobm9kZSwgcXVhZElkeCk7XG4gICAgICAgICAgaWYgKCFjaGlsZCkge1xuICAgICAgICAgICAgLy8gVGhlIG5vZGUgaXMgaW50ZXJuYWwgYnV0IHRoaXMgcXVhZHJhbnQgaXMgbm90IHRha2VuLiBBZGQgc3Vibm9kZSB0byBpdC5cbiAgICAgICAgICAgIGNoaWxkID0gbmV3Tm9kZSgpO1xuICAgICAgICAgICAgY2hpbGQubGVmdCA9IGxlZnQ7XG4gICAgICAgICAgICBjaGlsZC50b3AgPSB0b3A7XG4gICAgICAgICAgICBjaGlsZC5yaWdodCA9IHJpZ2h0O1xuICAgICAgICAgICAgY2hpbGQuYm90dG9tID0gYm90dG9tO1xuICAgICAgICAgICAgY2hpbGQuYmFjayA9IGJhY2s7XG4gICAgICAgICAgICBjaGlsZC5mcm9udCA9IGZyb250O1xuICAgICAgICAgICAgY2hpbGQuYm9keSA9IGJvZHk7XG5cbiAgICAgICAgICAgIHNldENoaWxkKG5vZGUsIHF1YWRJZHgsIGNoaWxkKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gY29udGludWUgc2VhcmNoaW5nIGluIHRoaXMgcXVhZHJhbnQuXG4gICAgICAgICAgICBpbnNlcnRTdGFjay5wdXNoKGNoaWxkLCBib2R5KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gV2UgYXJlIHRyeWluZyB0byBhZGQgdG8gdGhlIGxlYWYgbm9kZS5cbiAgICAgICAgICAvLyBXZSBoYXZlIHRvIGNvbnZlcnQgY3VycmVudCBsZWFmIGludG8gaW50ZXJuYWwgbm9kZVxuICAgICAgICAgIC8vIGFuZCBjb250aW51ZSBhZGRpbmcgdHdvIG5vZGVzLlxuICAgICAgICAgIHZhciBvbGRCb2R5ID0gbm9kZS5ib2R5O1xuICAgICAgICAgIG5vZGUuYm9keSA9IG51bGw7IC8vIGludGVybmFsIG5vZGVzIGRvIG5vdCBjYXJyeSBib2RpZXNcblxuICAgICAgICAgIGlmIChpc1NhbWVQb3NpdGlvbihvbGRCb2R5LnBvcywgYm9keS5wb3MpKSB7XG4gICAgICAgICAgICAvLyBQcmV2ZW50IGluZmluaXRlIHN1YmRpdmlzaW9uIGJ5IGJ1bXBpbmcgb25lIG5vZGVcbiAgICAgICAgICAgIC8vIGFueXdoZXJlIGluIHRoaXMgcXVhZHJhbnRcbiAgICAgICAgICAgIHZhciByZXRyaWVzQ291bnQgPSAzO1xuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICB2YXIgb2Zmc2V0ID0gcmFuZG9tLm5leHREb3VibGUoKTtcbiAgICAgICAgICAgICAgdmFyIGR4ID0gKG5vZGUucmlnaHQgLSBub2RlLmxlZnQpICogb2Zmc2V0O1xuICAgICAgICAgICAgICB2YXIgZHkgPSAobm9kZS5ib3R0b20gLSBub2RlLnRvcCkgKiBvZmZzZXQ7XG4gICAgICAgICAgICAgIHZhciBkeiA9IChub2RlLmZyb250IC0gbm9kZS5iYWNrKSAqIG9mZnNldDtcblxuICAgICAgICAgICAgICBvbGRCb2R5LnBvcy54ID0gbm9kZS5sZWZ0ICsgZHg7XG4gICAgICAgICAgICAgIG9sZEJvZHkucG9zLnkgPSBub2RlLnRvcCArIGR5O1xuICAgICAgICAgICAgICBvbGRCb2R5LnBvcy56ID0gbm9kZS5iYWNrICsgZHo7XG4gICAgICAgICAgICAgIHJldHJpZXNDb3VudCAtPSAxO1xuICAgICAgICAgICAgICAvLyBNYWtlIHN1cmUgd2UgZG9uJ3QgYnVtcCBpdCBvdXQgb2YgdGhlIGJveC4gSWYgd2UgZG8sIG5leHQgaXRlcmF0aW9uIHNob3VsZCBmaXggaXRcbiAgICAgICAgICAgIH0gd2hpbGUgKHJldHJpZXNDb3VudCA+IDAgJiYgaXNTYW1lUG9zaXRpb24ob2xkQm9keS5wb3MsIGJvZHkucG9zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZXRyaWVzQ291bnQgPT09IDAgJiYgaXNTYW1lUG9zaXRpb24ob2xkQm9keS5wb3MsIGJvZHkucG9zKSkge1xuICAgICAgICAgICAgICAvLyBUaGlzIGlzIHZlcnkgYmFkLCB3ZSByYW4gb3V0IG9mIHByZWNpc2lvbi5cbiAgICAgICAgICAgICAgLy8gaWYgd2UgZG8gbm90IHJldHVybiBmcm9tIHRoZSBtZXRob2Qgd2UnbGwgZ2V0IGludG9cbiAgICAgICAgICAgICAgLy8gaW5maW5pdGUgbG9vcCBoZXJlLiBTbyB3ZSBzYWNyaWZpY2UgY29ycmVjdG5lc3Mgb2YgbGF5b3V0LCBhbmQga2VlcCB0aGUgYXBwIHJ1bm5pbmdcbiAgICAgICAgICAgICAgLy8gTmV4dCBsYXlvdXQgaXRlcmF0aW9uIHNob3VsZCBnZXQgbGFyZ2VyIGJvdW5kaW5nIGJveCBpbiB0aGUgZmlyc3Qgc3RlcCBhbmQgZml4IHRoaXNcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBOZXh0IGl0ZXJhdGlvbiBzaG91bGQgc3ViZGl2aWRlIG5vZGUgZnVydGhlci5cbiAgICAgICAgICBpbnNlcnRTdGFjay5wdXNoKG5vZGUsIG9sZEJvZHkpO1xuICAgICAgICAgIGluc2VydFN0YWNrLnB1c2gobm9kZSwgYm9keSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlID0gZnVuY3Rpb24oc291cmNlQm9keSkge1xuICAgICAgdmFyIHF1ZXVlID0gdXBkYXRlUXVldWUsXG4gICAgICAgIHYsXG4gICAgICAgIGR4LCBkeSwgZHosXG4gICAgICAgIHIsIGZ4ID0gMCxcbiAgICAgICAgZnkgPSAwLFxuICAgICAgICBmeiA9IDAsXG4gICAgICAgIHF1ZXVlTGVuZ3RoID0gMSxcbiAgICAgICAgc2hpZnRJZHggPSAwLFxuICAgICAgICBwdXNoSWR4ID0gMTtcblxuICAgICAgcXVldWVbMF0gPSByb290O1xuXG4gICAgICB3aGlsZSAocXVldWVMZW5ndGgpIHtcbiAgICAgICAgdmFyIG5vZGUgPSBxdWV1ZVtzaGlmdElkeF0sXG4gICAgICAgICAgYm9keSA9IG5vZGUuYm9keTtcblxuICAgICAgICBxdWV1ZUxlbmd0aCAtPSAxO1xuICAgICAgICBzaGlmdElkeCArPSAxO1xuICAgICAgICB2YXIgZGlmZmVyZW50Qm9keSA9IChib2R5ICE9PSBzb3VyY2VCb2R5KTtcbiAgICAgICAgaWYgKGJvZHkgJiYgZGlmZmVyZW50Qm9keSkge1xuICAgICAgICAgIC8vIElmIHRoZSBjdXJyZW50IG5vZGUgaXMgYSBsZWFmIG5vZGUgKGFuZCBpdCBpcyBub3Qgc291cmNlIGJvZHkpLFxuICAgICAgICAgIC8vIGNhbGN1bGF0ZSB0aGUgZm9yY2UgZXhlcnRlZCBieSB0aGUgY3VycmVudCBub2RlIG9uIGJvZHksIGFuZCBhZGQgdGhpc1xuICAgICAgICAgIC8vIGFtb3VudCB0byBib2R5J3MgbmV0IGZvcmNlLlxuICAgICAgICAgIGR4ID0gYm9keS5wb3MueCAtIHNvdXJjZUJvZHkucG9zLng7XG4gICAgICAgICAgZHkgPSBib2R5LnBvcy55IC0gc291cmNlQm9keS5wb3MueTtcbiAgICAgICAgICBkeiA9IGJvZHkucG9zLnogLSBzb3VyY2VCb2R5LnBvcy56O1xuICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkgKyBkeiAqIGR6KTtcblxuICAgICAgICAgIGlmIChyID09PSAwKSB7XG4gICAgICAgICAgICAvLyBQb29yIG1hbidzIHByb3RlY3Rpb24gYWdhaW5zdCB6ZXJvIGRpc3RhbmNlLlxuICAgICAgICAgICAgZHggPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICAgIGR5ID0gKHJhbmRvbS5uZXh0RG91YmxlKCkgLSAwLjUpIC8gNTA7XG4gICAgICAgICAgICBkeiA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSArIGR6ICogZHopO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFRoaXMgaXMgc3RhbmRhcmQgZ3Jhdml0YXRpb24gZm9yY2UgY2FsY3VsYXRpb24gYnV0IHdlIGRpdmlkZVxuICAgICAgICAgIC8vIGJ5IHJeMyB0byBzYXZlIHR3byBvcGVyYXRpb25zIHdoZW4gbm9ybWFsaXppbmcgZm9yY2UgdmVjdG9yLlxuICAgICAgICAgIHYgPSBncmF2aXR5ICogYm9keS5tYXNzICogc291cmNlQm9keS5tYXNzIC8gKHIgKiByICogcik7XG4gICAgICAgICAgZnggKz0gdiAqIGR4O1xuICAgICAgICAgIGZ5ICs9IHYgKiBkeTtcbiAgICAgICAgICBmeiArPSB2ICogZHo7XG4gICAgICAgIH0gZWxzZSBpZiAoZGlmZmVyZW50Qm9keSkge1xuICAgICAgICAgIC8vIE90aGVyd2lzZSwgY2FsY3VsYXRlIHRoZSByYXRpbyBzIC8gciwgIHdoZXJlIHMgaXMgdGhlIHdpZHRoIG9mIHRoZSByZWdpb25cbiAgICAgICAgICAvLyByZXByZXNlbnRlZCBieSB0aGUgaW50ZXJuYWwgbm9kZSwgYW5kIHIgaXMgdGhlIGRpc3RhbmNlIGJldHdlZW4gdGhlIGJvZHlcbiAgICAgICAgICAvLyBhbmQgdGhlIG5vZGUncyBjZW50ZXItb2YtbWFzc1xuICAgICAgICAgIGR4ID0gbm9kZS5tYXNzWCAvIG5vZGUubWFzcyAtIHNvdXJjZUJvZHkucG9zLng7XG4gICAgICAgICAgZHkgPSBub2RlLm1hc3NZIC8gbm9kZS5tYXNzIC0gc291cmNlQm9keS5wb3MueTtcbiAgICAgICAgICBkeiA9IG5vZGUubWFzc1ogLyBub2RlLm1hc3MgLSBzb3VyY2VCb2R5LnBvcy56O1xuXG4gICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSArIGR6ICogZHopO1xuXG4gICAgICAgICAgaWYgKHIgPT09IDApIHtcbiAgICAgICAgICAgIC8vIFNvcnJ5IGFib3V0IGNvZGUgZHVwbGljYXRpb24uIEkgZG9uJ3Qgd2FudCB0byBjcmVhdGUgbWFueSBmdW5jdGlvbnNcbiAgICAgICAgICAgIC8vIHJpZ2h0IGF3YXkuIEp1c3Qgd2FudCB0byBzZWUgcGVyZm9ybWFuY2UgZmlyc3QuXG4gICAgICAgICAgICBkeCA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgICAgZHkgPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICAgIGR6ID0gKHJhbmRvbS5uZXh0RG91YmxlKCkgLSAwLjUpIC8gNTA7XG4gICAgICAgICAgICByID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5ICsgZHogKiBkeik7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gSWYgcyAvIHIgPCDOuCwgdHJlYXQgdGhpcyBpbnRlcm5hbCBub2RlIGFzIGEgc2luZ2xlIGJvZHksIGFuZCBjYWxjdWxhdGUgdGhlXG4gICAgICAgICAgLy8gZm9yY2UgaXQgZXhlcnRzIG9uIHNvdXJjZUJvZHksIGFuZCBhZGQgdGhpcyBhbW91bnQgdG8gc291cmNlQm9keSdzIG5ldCBmb3JjZS5cbiAgICAgICAgICBpZiAoKG5vZGUucmlnaHQgLSBub2RlLmxlZnQpIC8gciA8IHRoZXRhKSB7XG4gICAgICAgICAgICAvLyBpbiB0aGUgaWYgc3RhdGVtZW50IGFib3ZlIHdlIGNvbnNpZGVyIG5vZGUncyB3aWR0aCBvbmx5XG4gICAgICAgICAgICAvLyBiZWNhdXNlIHRoZSByZWdpb24gd2FzIHNxdWFyaWZpZWQgZHVyaW5nIHRyZWUgY3JlYXRpb24uXG4gICAgICAgICAgICAvLyBUaHVzIHRoZXJlIGlzIG5vIGRpZmZlcmVuY2UgYmV0d2VlbiB1c2luZyB3aWR0aCBvciBoZWlnaHQuXG4gICAgICAgICAgICB2ID0gZ3Jhdml0eSAqIG5vZGUubWFzcyAqIHNvdXJjZUJvZHkubWFzcyAvIChyICogciAqIHIpO1xuICAgICAgICAgICAgZnggKz0gdiAqIGR4O1xuICAgICAgICAgICAgZnkgKz0gdiAqIGR5O1xuICAgICAgICAgICAgZnogKz0gdiAqIGR6O1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBPdGhlcndpc2UsIHJ1biB0aGUgcHJvY2VkdXJlIHJlY3Vyc2l2ZWx5IG9uIGVhY2ggb2YgdGhlIGN1cnJlbnQgbm9kZSdzIGNoaWxkcmVuLlxuXG4gICAgICAgICAgICAvLyBJIGludGVudGlvbmFsbHkgdW5mb2xkZWQgdGhpcyBsb29wLCB0byBzYXZlIHNldmVyYWwgQ1BVIGN5Y2xlcy5cbiAgICAgICAgICAgIGlmIChub2RlLnF1YWQwKSB7XG4gICAgICAgICAgICAgIHF1ZXVlW3B1c2hJZHhdID0gbm9kZS5xdWFkMDtcbiAgICAgICAgICAgICAgcXVldWVMZW5ndGggKz0gMTtcbiAgICAgICAgICAgICAgcHVzaElkeCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vZGUucXVhZDEpIHtcbiAgICAgICAgICAgICAgcXVldWVbcHVzaElkeF0gPSBub2RlLnF1YWQxO1xuICAgICAgICAgICAgICBxdWV1ZUxlbmd0aCArPSAxO1xuICAgICAgICAgICAgICBwdXNoSWR4ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm9kZS5xdWFkMikge1xuICAgICAgICAgICAgICBxdWV1ZVtwdXNoSWR4XSA9IG5vZGUucXVhZDI7XG4gICAgICAgICAgICAgIHF1ZXVlTGVuZ3RoICs9IDE7XG4gICAgICAgICAgICAgIHB1c2hJZHggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChub2RlLnF1YWQzKSB7XG4gICAgICAgICAgICAgIHF1ZXVlW3B1c2hJZHhdID0gbm9kZS5xdWFkMztcbiAgICAgICAgICAgICAgcXVldWVMZW5ndGggKz0gMTtcbiAgICAgICAgICAgICAgcHVzaElkeCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vZGUucXVhZDQpIHtcbiAgICAgICAgICAgICAgcXVldWVbcHVzaElkeF0gPSBub2RlLnF1YWQ0O1xuICAgICAgICAgICAgICBxdWV1ZUxlbmd0aCArPSAxO1xuICAgICAgICAgICAgICBwdXNoSWR4ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm9kZS5xdWFkNSkge1xuICAgICAgICAgICAgICBxdWV1ZVtwdXNoSWR4XSA9IG5vZGUucXVhZDU7XG4gICAgICAgICAgICAgIHF1ZXVlTGVuZ3RoICs9IDE7XG4gICAgICAgICAgICAgIHB1c2hJZHggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChub2RlLnF1YWQ2KSB7XG4gICAgICAgICAgICAgIHF1ZXVlW3B1c2hJZHhdID0gbm9kZS5xdWFkNjtcbiAgICAgICAgICAgICAgcXVldWVMZW5ndGggKz0gMTtcbiAgICAgICAgICAgICAgcHVzaElkeCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vZGUucXVhZDcpIHtcbiAgICAgICAgICAgICAgcXVldWVbcHVzaElkeF0gPSBub2RlLnF1YWQ3O1xuICAgICAgICAgICAgICBxdWV1ZUxlbmd0aCArPSAxO1xuICAgICAgICAgICAgICBwdXNoSWR4ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHNvdXJjZUJvZHkuZm9yY2UueCArPSBmeDtcbiAgICAgIHNvdXJjZUJvZHkuZm9yY2UueSArPSBmeTtcbiAgICAgIHNvdXJjZUJvZHkuZm9yY2UueiArPSBmejtcbiAgICB9LFxuXG4gICAgaW5zZXJ0Qm9kaWVzID0gZnVuY3Rpb24oYm9kaWVzKSB7XG4gICAgICB2YXIgeDEgPSBOdW1iZXIuTUFYX1ZBTFVFLFxuICAgICAgICB5MSA9IE51bWJlci5NQVhfVkFMVUUsXG4gICAgICAgIHoxID0gTnVtYmVyLk1BWF9WQUxVRSxcbiAgICAgICAgeDIgPSBOdW1iZXIuTUlOX1ZBTFVFLFxuICAgICAgICB5MiA9IE51bWJlci5NSU5fVkFMVUUsXG4gICAgICAgIHoyID0gTnVtYmVyLk1JTl9WQUxVRSxcbiAgICAgICAgaSxcbiAgICAgICAgbWF4ID0gYm9kaWVzLmxlbmd0aDtcblxuICAgICAgLy8gVG8gcmVkdWNlIHF1YWQgdHJlZSBkZXB0aCB3ZSBhcmUgbG9va2luZyBmb3IgZXhhY3QgYm91bmRpbmcgYm94IG9mIGFsbCBwYXJ0aWNsZXMuXG4gICAgICBpID0gbWF4O1xuICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICB2YXIgcG9zID0gYm9kaWVzW2ldLnBvcztcbiAgICAgICAgdmFyIHggPSBwb3MueDtcbiAgICAgICAgdmFyIHkgPSBwb3MueTtcbiAgICAgICAgdmFyIHogPSBwb3MuejtcbiAgICAgICAgaWYgKHggPCB4MSkge1xuICAgICAgICAgIHgxID0geDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoeCA+IHgyKSB7XG4gICAgICAgICAgeDIgPSB4O1xuICAgICAgICB9XG4gICAgICAgIGlmICh5IDwgeTEpIHtcbiAgICAgICAgICB5MSA9IHk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHkgPiB5Mikge1xuICAgICAgICAgIHkyID0geTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoeiA8IHoxKSB7XG4gICAgICAgICAgejEgPSB6O1xuICAgICAgICB9XG4gICAgICAgIGlmICh6ID4gejIpIHtcbiAgICAgICAgICB6MiA9IHo7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gU3F1YXJpZnkgdGhlIGJvdW5kcy5cbiAgICAgIHZhciBtYXhTaWRlID0gTWF0aC5tYXgoeDIgLSB4MSwgTWF0aC5tYXgoeTIgLSB5MSwgejIgLSB6MSkpO1xuXG4gICAgICB4MiA9IHgxICsgbWF4U2lkZTtcbiAgICAgIHkyID0geTEgKyBtYXhTaWRlO1xuICAgICAgejIgPSB6MSArIG1heFNpZGU7XG5cbiAgICAgIGN1cnJlbnRJbkNhY2hlID0gMDtcbiAgICAgIHJvb3QgPSBuZXdOb2RlKCk7XG4gICAgICByb290LmxlZnQgPSB4MTtcbiAgICAgIHJvb3QucmlnaHQgPSB4MjtcbiAgICAgIHJvb3QudG9wID0geTE7XG4gICAgICByb290LmJvdHRvbSA9IHkyO1xuICAgICAgcm9vdC5iYWNrID0gejE7XG4gICAgICByb290LmZyb250ID0gejI7XG5cbiAgICAgIGkgPSBtYXggLSAxO1xuICAgICAgaWYgKGkgPiAwKSB7XG4gICAgICAgIHJvb3QuYm9keSA9IGJvZGllc1tpXTtcbiAgICAgIH1cbiAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgaW5zZXJ0KGJvZGllc1tpXSwgcm9vdCk7XG4gICAgICB9XG4gICAgfTtcblxuICByZXR1cm4ge1xuICAgIGluc2VydEJvZGllczogaW5zZXJ0Qm9kaWVzLFxuICAgIHVwZGF0ZUJvZHlGb3JjZTogdXBkYXRlLFxuICAgIG9wdGlvbnM6IGZ1bmN0aW9uKG5ld09wdGlvbnMpIHtcbiAgICAgIGlmIChuZXdPcHRpb25zKSB7XG4gICAgICAgIGlmICh0eXBlb2YgbmV3T3B0aW9ucy5ncmF2aXR5ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGdyYXZpdHkgPSBuZXdPcHRpb25zLmdyYXZpdHk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBuZXdPcHRpb25zLnRoZXRhID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHRoZXRhID0gbmV3T3B0aW9ucy50aGV0YTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBncmF2aXR5OiBncmF2aXR5LFxuICAgICAgICB0aGV0YTogdGhldGFcbiAgICAgIH07XG4gICAgfVxuICB9O1xufTtcblxuZnVuY3Rpb24gZ2V0Q2hpbGQobm9kZSwgaWR4KSB7XG4gIGlmIChpZHggPT09IDApIHJldHVybiBub2RlLnF1YWQwO1xuICBpZiAoaWR4ID09PSAxKSByZXR1cm4gbm9kZS5xdWFkMTtcbiAgaWYgKGlkeCA9PT0gMikgcmV0dXJuIG5vZGUucXVhZDI7XG4gIGlmIChpZHggPT09IDMpIHJldHVybiBub2RlLnF1YWQzO1xuICBpZiAoaWR4ID09PSA0KSByZXR1cm4gbm9kZS5xdWFkNDtcbiAgaWYgKGlkeCA9PT0gNSkgcmV0dXJuIG5vZGUucXVhZDU7XG4gIGlmIChpZHggPT09IDYpIHJldHVybiBub2RlLnF1YWQ2O1xuICBpZiAoaWR4ID09PSA3KSByZXR1cm4gbm9kZS5xdWFkNztcbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIHNldENoaWxkKG5vZGUsIGlkeCwgY2hpbGQpIHtcbiAgaWYgKGlkeCA9PT0gMCkgbm9kZS5xdWFkMCA9IGNoaWxkO1xuICBlbHNlIGlmIChpZHggPT09IDEpIG5vZGUucXVhZDEgPSBjaGlsZDtcbiAgZWxzZSBpZiAoaWR4ID09PSAyKSBub2RlLnF1YWQyID0gY2hpbGQ7XG4gIGVsc2UgaWYgKGlkeCA9PT0gMykgbm9kZS5xdWFkMyA9IGNoaWxkO1xuICBlbHNlIGlmIChpZHggPT09IDQpIG5vZGUucXVhZDQgPSBjaGlsZDtcbiAgZWxzZSBpZiAoaWR4ID09PSA1KSBub2RlLnF1YWQ1ID0gY2hpbGQ7XG4gIGVsc2UgaWYgKGlkeCA9PT0gNikgbm9kZS5xdWFkNiA9IGNoaWxkO1xuICBlbHNlIGlmIChpZHggPT09IDcpIG5vZGUucXVhZDcgPSBjaGlsZDtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gSW5zZXJ0U3RhY2s7XG5cbi8qKlxuICogT3VyIGltcGxlbWVudGF0aW9uIG9mIFF1YWRUcmVlIGlzIG5vbi1yZWN1cnNpdmUgdG8gYXZvaWQgR0MgaGl0XG4gKiBUaGlzIGRhdGEgc3RydWN0dXJlIHJlcHJlc2VudCBzdGFjayBvZiBlbGVtZW50c1xuICogd2hpY2ggd2UgYXJlIHRyeWluZyB0byBpbnNlcnQgaW50byBxdWFkIHRyZWUuXG4gKi9cbmZ1bmN0aW9uIEluc2VydFN0YWNrICgpIHtcbiAgICB0aGlzLnN0YWNrID0gW107XG4gICAgdGhpcy5wb3BJZHggPSAwO1xufVxuXG5JbnNlcnRTdGFjay5wcm90b3R5cGUgPSB7XG4gICAgaXNFbXB0eTogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnBvcElkeCA9PT0gMDtcbiAgICB9LFxuICAgIHB1c2g6IGZ1bmN0aW9uIChub2RlLCBib2R5KSB7XG4gICAgICAgIHZhciBpdGVtID0gdGhpcy5zdGFja1t0aGlzLnBvcElkeF07XG4gICAgICAgIGlmICghaXRlbSkge1xuICAgICAgICAgICAgLy8gd2UgYXJlIHRyeWluZyB0byBhdm9pZCBtZW1vcnkgcHJlc3N1cmU6IGNyZWF0ZSBuZXcgZWxlbWVudFxuICAgICAgICAgICAgLy8gb25seSB3aGVuIGFic29sdXRlbHkgbmVjZXNzYXJ5XG4gICAgICAgICAgICB0aGlzLnN0YWNrW3RoaXMucG9wSWR4XSA9IG5ldyBJbnNlcnRTdGFja0VsZW1lbnQobm9kZSwgYm9keSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpdGVtLm5vZGUgPSBub2RlO1xuICAgICAgICAgICAgaXRlbS5ib2R5ID0gYm9keTtcbiAgICAgICAgfVxuICAgICAgICArK3RoaXMucG9wSWR4O1xuICAgIH0sXG4gICAgcG9wOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLnBvcElkeCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN0YWNrWy0tdGhpcy5wb3BJZHhdO1xuICAgICAgICB9XG4gICAgfSxcbiAgICByZXNldDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnBvcElkeCA9IDA7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gSW5zZXJ0U3RhY2tFbGVtZW50KG5vZGUsIGJvZHkpIHtcbiAgICB0aGlzLm5vZGUgPSBub2RlOyAvLyBRdWFkVHJlZSBub2RlXG4gICAgdGhpcy5ib2R5ID0gYm9keTsgLy8gcGh5c2ljYWwgYm9keSB3aGljaCBuZWVkcyB0byBiZSBpbnNlcnRlZCB0byBub2RlXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGlzU2FtZVBvc2l0aW9uKHBvaW50MSwgcG9pbnQyKSB7XG4gICAgdmFyIGR4ID0gTWF0aC5hYnMocG9pbnQxLnggLSBwb2ludDIueCk7XG4gICAgdmFyIGR5ID0gTWF0aC5hYnMocG9pbnQxLnkgLSBwb2ludDIueSk7XG4gICAgdmFyIGR6ID0gTWF0aC5hYnMocG9pbnQxLnogLSBwb2ludDIueik7XG5cbiAgICByZXR1cm4gKGR4IDwgMWUtOCAmJiBkeSA8IDFlLTggJiYgZHogPCAxZS04KTtcbn07XG4iLCIvKipcbiAqIEludGVybmFsIGRhdGEgc3RydWN0dXJlIHRvIHJlcHJlc2VudCAzRCBRdWFkVHJlZSBub2RlXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gTm9kZSgpIHtcbiAgLy8gYm9keSBzdG9yZWQgaW5zaWRlIHRoaXMgbm9kZS4gSW4gcXVhZCB0cmVlIG9ubHkgbGVhZiBub2RlcyAoYnkgY29uc3RydWN0aW9uKVxuICAvLyBjb250YWluIGJvaWRlczpcbiAgdGhpcy5ib2R5ID0gbnVsbDtcblxuICAvLyBDaGlsZCBub2RlcyBhcmUgc3RvcmVkIGluIHF1YWRzLiBFYWNoIHF1YWQgaXMgcHJlc2VudGVkIGJ5IG51bWJlcjpcbiAgLy8gQmVoaW5kIFogbWVkaWFuOlxuICAvLyAwIHwgMVxuICAvLyAtLS0tLVxuICAvLyAyIHwgM1xuICAvLyBJbiBmcm9udCBvZiBaIG1lZGlhbjpcbiAgLy8gNCB8IDVcbiAgLy8gLS0tLS1cbiAgLy8gNiB8IDdcbiAgdGhpcy5xdWFkMCA9IG51bGw7XG4gIHRoaXMucXVhZDEgPSBudWxsO1xuICB0aGlzLnF1YWQyID0gbnVsbDtcbiAgdGhpcy5xdWFkMyA9IG51bGw7XG4gIHRoaXMucXVhZDQgPSBudWxsO1xuICB0aGlzLnF1YWQ1ID0gbnVsbDtcbiAgdGhpcy5xdWFkNiA9IG51bGw7XG4gIHRoaXMucXVhZDcgPSBudWxsO1xuXG4gIC8vIFRvdGFsIG1hc3Mgb2YgY3VycmVudCBub2RlXG4gIHRoaXMubWFzcyA9IDA7XG5cbiAgLy8gQ2VudGVyIG9mIG1hc3MgY29vcmRpbmF0ZXNcbiAgdGhpcy5tYXNzWCA9IDA7XG4gIHRoaXMubWFzc1kgPSAwO1xuICB0aGlzLm1hc3NaID0gMDtcblxuICAvLyBib3VuZGluZyBib3ggY29vcmRpbmF0ZXNcbiAgdGhpcy5sZWZ0ID0gMDtcbiAgdGhpcy50b3AgPSAwO1xuICB0aGlzLmJvdHRvbSA9IDA7XG4gIHRoaXMucmlnaHQgPSAwO1xuICB0aGlzLmZyb250ID0gMDtcbiAgdGhpcy5iYWNrID0gMDtcbn07XG4iLCIvKipcbiAqIFRoaXMgaXMgQmFybmVzIEh1dCBzaW11bGF0aW9uIGFsZ29yaXRobSBmb3IgMmQgY2FzZS4gSW1wbGVtZW50YXRpb25cbiAqIGlzIGhpZ2hseSBvcHRpbWl6ZWQgKGF2b2lkcyByZWN1c2lvbiBhbmQgZ2MgcHJlc3N1cmUpXG4gKlxuICogaHR0cDovL3d3dy5jcy5wcmluY2V0b24uZWR1L2NvdXJzZXMvYXJjaGl2ZS9mYWxsMDMvY3MxMjYvYXNzaWdubWVudHMvYmFybmVzLWh1dC5odG1sXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvcHRpb25zKSB7XG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICBvcHRpb25zLmdyYXZpdHkgPSB0eXBlb2Ygb3B0aW9ucy5ncmF2aXR5ID09PSAnbnVtYmVyJyA/IG9wdGlvbnMuZ3Jhdml0eSA6IC0xO1xuICBvcHRpb25zLnRoZXRhID0gdHlwZW9mIG9wdGlvbnMudGhldGEgPT09ICdudW1iZXInID8gb3B0aW9ucy50aGV0YSA6IDAuODtcblxuICAvLyB3ZSByZXF1aXJlIGRldGVybWluaXN0aWMgcmFuZG9tbmVzcyBoZXJlXG4gIHZhciByYW5kb20gPSByZXF1aXJlKCduZ3JhcGgucmFuZG9tJykucmFuZG9tKDE5ODQpLFxuICAgIE5vZGUgPSByZXF1aXJlKCcuL25vZGUnKSxcbiAgICBJbnNlcnRTdGFjayA9IHJlcXVpcmUoJy4vaW5zZXJ0U3RhY2snKSxcbiAgICBpc1NhbWVQb3NpdGlvbiA9IHJlcXVpcmUoJy4vaXNTYW1lUG9zaXRpb24nKTtcblxuICB2YXIgZ3Jhdml0eSA9IG9wdGlvbnMuZ3Jhdml0eSxcbiAgICB1cGRhdGVRdWV1ZSA9IFtdLFxuICAgIGluc2VydFN0YWNrID0gbmV3IEluc2VydFN0YWNrKCksXG4gICAgdGhldGEgPSBvcHRpb25zLnRoZXRhLFxuXG4gICAgbm9kZXNDYWNoZSA9IFtdLFxuICAgIGN1cnJlbnRJbkNhY2hlID0gMCxcbiAgICBuZXdOb2RlID0gZnVuY3Rpb24oKSB7XG4gICAgICAvLyBUbyBhdm9pZCBwcmVzc3VyZSBvbiBHQyB3ZSByZXVzZSBub2Rlcy5cbiAgICAgIHZhciBub2RlID0gbm9kZXNDYWNoZVtjdXJyZW50SW5DYWNoZV07XG4gICAgICBpZiAobm9kZSkge1xuICAgICAgICBub2RlLnF1YWQwID0gbnVsbDtcbiAgICAgICAgbm9kZS5xdWFkMSA9IG51bGw7XG4gICAgICAgIG5vZGUucXVhZDIgPSBudWxsO1xuICAgICAgICBub2RlLnF1YWQzID0gbnVsbDtcbiAgICAgICAgbm9kZS5ib2R5ID0gbnVsbDtcbiAgICAgICAgbm9kZS5tYXNzID0gbm9kZS5tYXNzWCA9IG5vZGUubWFzc1kgPSAwO1xuICAgICAgICBub2RlLmxlZnQgPSBub2RlLnJpZ2h0ID0gbm9kZS50b3AgPSBub2RlLmJvdHRvbSA9IDA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBub2RlID0gbmV3IE5vZGUoKTtcbiAgICAgICAgbm9kZXNDYWNoZVtjdXJyZW50SW5DYWNoZV0gPSBub2RlO1xuICAgICAgfVxuXG4gICAgICArK2N1cnJlbnRJbkNhY2hlO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSxcblxuICAgIHJvb3QgPSBuZXdOb2RlKCksXG5cbiAgICAvLyBJbnNlcnRzIGJvZHkgdG8gdGhlIHRyZWVcbiAgICBpbnNlcnQgPSBmdW5jdGlvbihuZXdCb2R5KSB7XG4gICAgICBpbnNlcnRTdGFjay5yZXNldCgpO1xuICAgICAgaW5zZXJ0U3RhY2sucHVzaChyb290LCBuZXdCb2R5KTtcblxuICAgICAgd2hpbGUgKCFpbnNlcnRTdGFjay5pc0VtcHR5KCkpIHtcbiAgICAgICAgdmFyIHN0YWNrSXRlbSA9IGluc2VydFN0YWNrLnBvcCgpLFxuICAgICAgICAgIG5vZGUgPSBzdGFja0l0ZW0ubm9kZSxcbiAgICAgICAgICBib2R5ID0gc3RhY2tJdGVtLmJvZHk7XG5cbiAgICAgICAgaWYgKCFub2RlLmJvZHkpIHtcbiAgICAgICAgICAvLyBUaGlzIGlzIGludGVybmFsIG5vZGUuIFVwZGF0ZSB0aGUgdG90YWwgbWFzcyBvZiB0aGUgbm9kZSBhbmQgY2VudGVyLW9mLW1hc3MuXG4gICAgICAgICAgdmFyIHggPSBib2R5LnBvcy54O1xuICAgICAgICAgIHZhciB5ID0gYm9keS5wb3MueTtcbiAgICAgICAgICBub2RlLm1hc3MgPSBub2RlLm1hc3MgKyBib2R5Lm1hc3M7XG4gICAgICAgICAgbm9kZS5tYXNzWCA9IG5vZGUubWFzc1ggKyBib2R5Lm1hc3MgKiB4O1xuICAgICAgICAgIG5vZGUubWFzc1kgPSBub2RlLm1hc3NZICsgYm9keS5tYXNzICogeTtcblxuICAgICAgICAgIC8vIFJlY3Vyc2l2ZWx5IGluc2VydCB0aGUgYm9keSBpbiB0aGUgYXBwcm9wcmlhdGUgcXVhZHJhbnQuXG4gICAgICAgICAgLy8gQnV0IGZpcnN0IGZpbmQgdGhlIGFwcHJvcHJpYXRlIHF1YWRyYW50LlxuICAgICAgICAgIHZhciBxdWFkSWR4ID0gMCwgLy8gQXNzdW1lIHdlIGFyZSBpbiB0aGUgMCdzIHF1YWQuXG4gICAgICAgICAgICBsZWZ0ID0gbm9kZS5sZWZ0LFxuICAgICAgICAgICAgcmlnaHQgPSAobm9kZS5yaWdodCArIGxlZnQpIC8gMixcbiAgICAgICAgICAgIHRvcCA9IG5vZGUudG9wLFxuICAgICAgICAgICAgYm90dG9tID0gKG5vZGUuYm90dG9tICsgdG9wKSAvIDI7XG5cbiAgICAgICAgICBpZiAoeCA+IHJpZ2h0KSB7IC8vIHNvbWV3aGVyZSBpbiB0aGUgZWFzdGVybiBwYXJ0LlxuICAgICAgICAgICAgcXVhZElkeCA9IHF1YWRJZHggKyAxO1xuICAgICAgICAgICAgdmFyIG9sZExlZnQgPSBsZWZ0O1xuICAgICAgICAgICAgbGVmdCA9IHJpZ2h0O1xuICAgICAgICAgICAgcmlnaHQgPSByaWdodCArIChyaWdodCAtIG9sZExlZnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoeSA+IGJvdHRvbSkgeyAvLyBhbmQgaW4gc291dGguXG4gICAgICAgICAgICBxdWFkSWR4ID0gcXVhZElkeCArIDI7XG4gICAgICAgICAgICB2YXIgb2xkVG9wID0gdG9wO1xuICAgICAgICAgICAgdG9wID0gYm90dG9tO1xuICAgICAgICAgICAgYm90dG9tID0gYm90dG9tICsgKGJvdHRvbSAtIG9sZFRvcCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdmFyIGNoaWxkID0gZ2V0Q2hpbGQobm9kZSwgcXVhZElkeCk7XG4gICAgICAgICAgaWYgKCFjaGlsZCkge1xuICAgICAgICAgICAgLy8gVGhlIG5vZGUgaXMgaW50ZXJuYWwgYnV0IHRoaXMgcXVhZHJhbnQgaXMgbm90IHRha2VuLiBBZGRcbiAgICAgICAgICAgIC8vIHN1Ym5vZGUgdG8gaXQuXG4gICAgICAgICAgICBjaGlsZCA9IG5ld05vZGUoKTtcbiAgICAgICAgICAgIGNoaWxkLmxlZnQgPSBsZWZ0O1xuICAgICAgICAgICAgY2hpbGQudG9wID0gdG9wO1xuICAgICAgICAgICAgY2hpbGQucmlnaHQgPSByaWdodDtcbiAgICAgICAgICAgIGNoaWxkLmJvdHRvbSA9IGJvdHRvbTtcbiAgICAgICAgICAgIGNoaWxkLmJvZHkgPSBib2R5O1xuXG4gICAgICAgICAgICBzZXRDaGlsZChub2RlLCBxdWFkSWR4LCBjaGlsZCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIGNvbnRpbnVlIHNlYXJjaGluZyBpbiB0aGlzIHF1YWRyYW50LlxuICAgICAgICAgICAgaW5zZXJ0U3RhY2sucHVzaChjaGlsZCwgYm9keSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFdlIGFyZSB0cnlpbmcgdG8gYWRkIHRvIHRoZSBsZWFmIG5vZGUuXG4gICAgICAgICAgLy8gV2UgaGF2ZSB0byBjb252ZXJ0IGN1cnJlbnQgbGVhZiBpbnRvIGludGVybmFsIG5vZGVcbiAgICAgICAgICAvLyBhbmQgY29udGludWUgYWRkaW5nIHR3byBub2Rlcy5cbiAgICAgICAgICB2YXIgb2xkQm9keSA9IG5vZGUuYm9keTtcbiAgICAgICAgICBub2RlLmJvZHkgPSBudWxsOyAvLyBpbnRlcm5hbCBub2RlcyBkbyBub3QgY2FyeSBib2RpZXNcblxuICAgICAgICAgIGlmIChpc1NhbWVQb3NpdGlvbihvbGRCb2R5LnBvcywgYm9keS5wb3MpKSB7XG4gICAgICAgICAgICAvLyBQcmV2ZW50IGluZmluaXRlIHN1YmRpdmlzaW9uIGJ5IGJ1bXBpbmcgb25lIG5vZGVcbiAgICAgICAgICAgIC8vIGFueXdoZXJlIGluIHRoaXMgcXVhZHJhbnRcbiAgICAgICAgICAgIHZhciByZXRyaWVzQ291bnQgPSAzO1xuICAgICAgICAgICAgZG8ge1xuICAgICAgICAgICAgICB2YXIgb2Zmc2V0ID0gcmFuZG9tLm5leHREb3VibGUoKTtcbiAgICAgICAgICAgICAgdmFyIGR4ID0gKG5vZGUucmlnaHQgLSBub2RlLmxlZnQpICogb2Zmc2V0O1xuICAgICAgICAgICAgICB2YXIgZHkgPSAobm9kZS5ib3R0b20gLSBub2RlLnRvcCkgKiBvZmZzZXQ7XG5cbiAgICAgICAgICAgICAgb2xkQm9keS5wb3MueCA9IG5vZGUubGVmdCArIGR4O1xuICAgICAgICAgICAgICBvbGRCb2R5LnBvcy55ID0gbm9kZS50b3AgKyBkeTtcbiAgICAgICAgICAgICAgcmV0cmllc0NvdW50IC09IDE7XG4gICAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSB3ZSBkb24ndCBidW1wIGl0IG91dCBvZiB0aGUgYm94LiBJZiB3ZSBkbywgbmV4dCBpdGVyYXRpb24gc2hvdWxkIGZpeCBpdFxuICAgICAgICAgICAgfSB3aGlsZSAocmV0cmllc0NvdW50ID4gMCAmJiBpc1NhbWVQb3NpdGlvbihvbGRCb2R5LnBvcywgYm9keS5wb3MpKTtcblxuICAgICAgICAgICAgaWYgKHJldHJpZXNDb3VudCA9PT0gMCAmJiBpc1NhbWVQb3NpdGlvbihvbGRCb2R5LnBvcywgYm9keS5wb3MpKSB7XG4gICAgICAgICAgICAgIC8vIFRoaXMgaXMgdmVyeSBiYWQsIHdlIHJhbiBvdXQgb2YgcHJlY2lzaW9uLlxuICAgICAgICAgICAgICAvLyBpZiB3ZSBkbyBub3QgcmV0dXJuIGZyb20gdGhlIG1ldGhvZCB3ZSdsbCBnZXQgaW50b1xuICAgICAgICAgICAgICAvLyBpbmZpbml0ZSBsb29wIGhlcmUuIFNvIHdlIHNhY3JpZmljZSBjb3JyZWN0bmVzcyBvZiBsYXlvdXQsIGFuZCBrZWVwIHRoZSBhcHAgcnVubmluZ1xuICAgICAgICAgICAgICAvLyBOZXh0IGxheW91dCBpdGVyYXRpb24gc2hvdWxkIGdldCBsYXJnZXIgYm91bmRpbmcgYm94IGluIHRoZSBmaXJzdCBzdGVwIGFuZCBmaXggdGhpc1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIE5leHQgaXRlcmF0aW9uIHNob3VsZCBzdWJkaXZpZGUgbm9kZSBmdXJ0aGVyLlxuICAgICAgICAgIGluc2VydFN0YWNrLnB1c2gobm9kZSwgb2xkQm9keSk7XG4gICAgICAgICAgaW5zZXJ0U3RhY2sucHVzaChub2RlLCBib2R5KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGUgPSBmdW5jdGlvbihzb3VyY2VCb2R5KSB7XG4gICAgICB2YXIgcXVldWUgPSB1cGRhdGVRdWV1ZSxcbiAgICAgICAgdixcbiAgICAgICAgZHgsXG4gICAgICAgIGR5LFxuICAgICAgICByLCBmeCA9IDAsXG4gICAgICAgIGZ5ID0gMCxcbiAgICAgICAgcXVldWVMZW5ndGggPSAxLFxuICAgICAgICBzaGlmdElkeCA9IDAsXG4gICAgICAgIHB1c2hJZHggPSAxO1xuXG4gICAgICBxdWV1ZVswXSA9IHJvb3Q7XG5cbiAgICAgIHdoaWxlIChxdWV1ZUxlbmd0aCkge1xuICAgICAgICB2YXIgbm9kZSA9IHF1ZXVlW3NoaWZ0SWR4XSxcbiAgICAgICAgICBib2R5ID0gbm9kZS5ib2R5O1xuXG4gICAgICAgIHF1ZXVlTGVuZ3RoIC09IDE7XG4gICAgICAgIHNoaWZ0SWR4ICs9IDE7XG4gICAgICAgIHZhciBkaWZmZXJlbnRCb2R5ID0gKGJvZHkgIT09IHNvdXJjZUJvZHkpO1xuICAgICAgICBpZiAoYm9keSAmJiBkaWZmZXJlbnRCb2R5KSB7XG4gICAgICAgICAgLy8gSWYgdGhlIGN1cnJlbnQgbm9kZSBpcyBhIGxlYWYgbm9kZSAoYW5kIGl0IGlzIG5vdCBzb3VyY2UgYm9keSksXG4gICAgICAgICAgLy8gY2FsY3VsYXRlIHRoZSBmb3JjZSBleGVydGVkIGJ5IHRoZSBjdXJyZW50IG5vZGUgb24gYm9keSwgYW5kIGFkZCB0aGlzXG4gICAgICAgICAgLy8gYW1vdW50IHRvIGJvZHkncyBuZXQgZm9yY2UuXG4gICAgICAgICAgZHggPSBib2R5LnBvcy54IC0gc291cmNlQm9keS5wb3MueDtcbiAgICAgICAgICBkeSA9IGJvZHkucG9zLnkgLSBzb3VyY2VCb2R5LnBvcy55O1xuICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xuXG4gICAgICAgICAgaWYgKHIgPT09IDApIHtcbiAgICAgICAgICAgIC8vIFBvb3IgbWFuJ3MgcHJvdGVjdGlvbiBhZ2FpbnN0IHplcm8gZGlzdGFuY2UuXG4gICAgICAgICAgICBkeCA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgICAgZHkgPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIFRoaXMgaXMgc3RhbmRhcmQgZ3Jhdml0aW9uIGZvcmNlIGNhbGN1bGF0aW9uIGJ1dCB3ZSBkaXZpZGVcbiAgICAgICAgICAvLyBieSByXjMgdG8gc2F2ZSB0d28gb3BlcmF0aW9ucyB3aGVuIG5vcm1hbGl6aW5nIGZvcmNlIHZlY3Rvci5cbiAgICAgICAgICB2ID0gZ3Jhdml0eSAqIGJvZHkubWFzcyAqIHNvdXJjZUJvZHkubWFzcyAvIChyICogciAqIHIpO1xuICAgICAgICAgIGZ4ICs9IHYgKiBkeDtcbiAgICAgICAgICBmeSArPSB2ICogZHk7XG4gICAgICAgIH0gZWxzZSBpZiAoZGlmZmVyZW50Qm9keSkge1xuICAgICAgICAgIC8vIE90aGVyd2lzZSwgY2FsY3VsYXRlIHRoZSByYXRpbyBzIC8gciwgIHdoZXJlIHMgaXMgdGhlIHdpZHRoIG9mIHRoZSByZWdpb25cbiAgICAgICAgICAvLyByZXByZXNlbnRlZCBieSB0aGUgaW50ZXJuYWwgbm9kZSwgYW5kIHIgaXMgdGhlIGRpc3RhbmNlIGJldHdlZW4gdGhlIGJvZHlcbiAgICAgICAgICAvLyBhbmQgdGhlIG5vZGUncyBjZW50ZXItb2YtbWFzc1xuICAgICAgICAgIGR4ID0gbm9kZS5tYXNzWCAvIG5vZGUubWFzcyAtIHNvdXJjZUJvZHkucG9zLng7XG4gICAgICAgICAgZHkgPSBub2RlLm1hc3NZIC8gbm9kZS5tYXNzIC0gc291cmNlQm9keS5wb3MueTtcbiAgICAgICAgICByID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcblxuICAgICAgICAgIGlmIChyID09PSAwKSB7XG4gICAgICAgICAgICAvLyBTb3JyeSBhYm91dCBjb2RlIGR1cGx1Y2F0aW9uLiBJIGRvbid0IHdhbnQgdG8gY3JlYXRlIG1hbnkgZnVuY3Rpb25zXG4gICAgICAgICAgICAvLyByaWdodCBhd2F5LiBKdXN0IHdhbnQgdG8gc2VlIHBlcmZvcm1hbmNlIGZpcnN0LlxuICAgICAgICAgICAgZHggPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICAgIGR5ID0gKHJhbmRvbS5uZXh0RG91YmxlKCkgLSAwLjUpIC8gNTA7XG4gICAgICAgICAgICByID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSWYgcyAvIHIgPCDOuCwgdHJlYXQgdGhpcyBpbnRlcm5hbCBub2RlIGFzIGEgc2luZ2xlIGJvZHksIGFuZCBjYWxjdWxhdGUgdGhlXG4gICAgICAgICAgLy8gZm9yY2UgaXQgZXhlcnRzIG9uIHNvdXJjZUJvZHksIGFuZCBhZGQgdGhpcyBhbW91bnQgdG8gc291cmNlQm9keSdzIG5ldCBmb3JjZS5cbiAgICAgICAgICBpZiAoKG5vZGUucmlnaHQgLSBub2RlLmxlZnQpIC8gciA8IHRoZXRhKSB7XG4gICAgICAgICAgICAvLyBpbiB0aGUgaWYgc3RhdGVtZW50IGFib3ZlIHdlIGNvbnNpZGVyIG5vZGUncyB3aWR0aCBvbmx5XG4gICAgICAgICAgICAvLyBiZWNhdXNlIHRoZSByZWdpb24gd2FzIHNxdWFyaWZpZWQgZHVyaW5nIHRyZWUgY3JlYXRpb24uXG4gICAgICAgICAgICAvLyBUaHVzIHRoZXJlIGlzIG5vIGRpZmZlcmVuY2UgYmV0d2VlbiB1c2luZyB3aWR0aCBvciBoZWlnaHQuXG4gICAgICAgICAgICB2ID0gZ3Jhdml0eSAqIG5vZGUubWFzcyAqIHNvdXJjZUJvZHkubWFzcyAvIChyICogciAqIHIpO1xuICAgICAgICAgICAgZnggKz0gdiAqIGR4O1xuICAgICAgICAgICAgZnkgKz0gdiAqIGR5O1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBPdGhlcndpc2UsIHJ1biB0aGUgcHJvY2VkdXJlIHJlY3Vyc2l2ZWx5IG9uIGVhY2ggb2YgdGhlIGN1cnJlbnQgbm9kZSdzIGNoaWxkcmVuLlxuXG4gICAgICAgICAgICAvLyBJIGludGVudGlvbmFsbHkgdW5mb2xkZWQgdGhpcyBsb29wLCB0byBzYXZlIHNldmVyYWwgQ1BVIGN5Y2xlcy5cbiAgICAgICAgICAgIGlmIChub2RlLnF1YWQwKSB7XG4gICAgICAgICAgICAgIHF1ZXVlW3B1c2hJZHhdID0gbm9kZS5xdWFkMDtcbiAgICAgICAgICAgICAgcXVldWVMZW5ndGggKz0gMTtcbiAgICAgICAgICAgICAgcHVzaElkeCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vZGUucXVhZDEpIHtcbiAgICAgICAgICAgICAgcXVldWVbcHVzaElkeF0gPSBub2RlLnF1YWQxO1xuICAgICAgICAgICAgICBxdWV1ZUxlbmd0aCArPSAxO1xuICAgICAgICAgICAgICBwdXNoSWR4ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm9kZS5xdWFkMikge1xuICAgICAgICAgICAgICBxdWV1ZVtwdXNoSWR4XSA9IG5vZGUucXVhZDI7XG4gICAgICAgICAgICAgIHF1ZXVlTGVuZ3RoICs9IDE7XG4gICAgICAgICAgICAgIHB1c2hJZHggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChub2RlLnF1YWQzKSB7XG4gICAgICAgICAgICAgIHF1ZXVlW3B1c2hJZHhdID0gbm9kZS5xdWFkMztcbiAgICAgICAgICAgICAgcXVldWVMZW5ndGggKz0gMTtcbiAgICAgICAgICAgICAgcHVzaElkeCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBzb3VyY2VCb2R5LmZvcmNlLnggKz0gZng7XG4gICAgICBzb3VyY2VCb2R5LmZvcmNlLnkgKz0gZnk7XG4gICAgfSxcblxuICAgIGluc2VydEJvZGllcyA9IGZ1bmN0aW9uKGJvZGllcykge1xuICAgICAgdmFyIHgxID0gTnVtYmVyLk1BWF9WQUxVRSxcbiAgICAgICAgeTEgPSBOdW1iZXIuTUFYX1ZBTFVFLFxuICAgICAgICB4MiA9IE51bWJlci5NSU5fVkFMVUUsXG4gICAgICAgIHkyID0gTnVtYmVyLk1JTl9WQUxVRSxcbiAgICAgICAgaSxcbiAgICAgICAgbWF4ID0gYm9kaWVzLmxlbmd0aDtcblxuICAgICAgLy8gVG8gcmVkdWNlIHF1YWQgdHJlZSBkZXB0aCB3ZSBhcmUgbG9va2luZyBmb3IgZXhhY3QgYm91bmRpbmcgYm94IG9mIGFsbCBwYXJ0aWNsZXMuXG4gICAgICBpID0gbWF4O1xuICAgICAgd2hpbGUgKGktLSkge1xuICAgICAgICB2YXIgeCA9IGJvZGllc1tpXS5wb3MueDtcbiAgICAgICAgdmFyIHkgPSBib2RpZXNbaV0ucG9zLnk7XG4gICAgICAgIGlmICh4IDwgeDEpIHtcbiAgICAgICAgICB4MSA9IHg7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHggPiB4Mikge1xuICAgICAgICAgIHgyID0geDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoeSA8IHkxKSB7XG4gICAgICAgICAgeTEgPSB5O1xuICAgICAgICB9XG4gICAgICAgIGlmICh5ID4geTIpIHtcbiAgICAgICAgICB5MiA9IHk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gU3F1YXJpZnkgdGhlIGJvdW5kcy5cbiAgICAgIHZhciBkeCA9IHgyIC0geDEsXG4gICAgICAgIGR5ID0geTIgLSB5MTtcbiAgICAgIGlmIChkeCA+IGR5KSB7XG4gICAgICAgIHkyID0geTEgKyBkeDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHgyID0geDEgKyBkeTtcbiAgICAgIH1cblxuICAgICAgY3VycmVudEluQ2FjaGUgPSAwO1xuICAgICAgcm9vdCA9IG5ld05vZGUoKTtcbiAgICAgIHJvb3QubGVmdCA9IHgxO1xuICAgICAgcm9vdC5yaWdodCA9IHgyO1xuICAgICAgcm9vdC50b3AgPSB5MTtcbiAgICAgIHJvb3QuYm90dG9tID0geTI7XG5cbiAgICAgIGkgPSBtYXggLSAxO1xuICAgICAgaWYgKGkgPiAwKSB7XG4gICAgICAgIHJvb3QuYm9keSA9IGJvZGllc1tpXTtcbiAgICAgIH1cbiAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgaW5zZXJ0KGJvZGllc1tpXSwgcm9vdCk7XG4gICAgICB9XG4gICAgfTtcblxuICByZXR1cm4ge1xuICAgIGluc2VydEJvZGllczogaW5zZXJ0Qm9kaWVzLFxuICAgIHVwZGF0ZUJvZHlGb3JjZTogdXBkYXRlLFxuICAgIG9wdGlvbnM6IGZ1bmN0aW9uKG5ld09wdGlvbnMpIHtcbiAgICAgIGlmIChuZXdPcHRpb25zKSB7XG4gICAgICAgIGlmICh0eXBlb2YgbmV3T3B0aW9ucy5ncmF2aXR5ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIGdyYXZpdHkgPSBuZXdPcHRpb25zLmdyYXZpdHk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBuZXdPcHRpb25zLnRoZXRhID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIHRoZXRhID0gbmV3T3B0aW9ucy50aGV0YTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBncmF2aXR5OiBncmF2aXR5LFxuICAgICAgICB0aGV0YTogdGhldGFcbiAgICAgIH07XG4gICAgfVxuICB9O1xufTtcblxuZnVuY3Rpb24gZ2V0Q2hpbGQobm9kZSwgaWR4KSB7XG4gIGlmIChpZHggPT09IDApIHJldHVybiBub2RlLnF1YWQwO1xuICBpZiAoaWR4ID09PSAxKSByZXR1cm4gbm9kZS5xdWFkMTtcbiAgaWYgKGlkeCA9PT0gMikgcmV0dXJuIG5vZGUucXVhZDI7XG4gIGlmIChpZHggPT09IDMpIHJldHVybiBub2RlLnF1YWQzO1xuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gc2V0Q2hpbGQobm9kZSwgaWR4LCBjaGlsZCkge1xuICBpZiAoaWR4ID09PSAwKSBub2RlLnF1YWQwID0gY2hpbGQ7XG4gIGVsc2UgaWYgKGlkeCA9PT0gMSkgbm9kZS5xdWFkMSA9IGNoaWxkO1xuICBlbHNlIGlmIChpZHggPT09IDIpIG5vZGUucXVhZDIgPSBjaGlsZDtcbiAgZWxzZSBpZiAoaWR4ID09PSAzKSBub2RlLnF1YWQzID0gY2hpbGQ7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEluc2VydFN0YWNrO1xuXG4vKipcbiAqIE91ciBpbXBsbWVudGF0aW9uIG9mIFF1YWRUcmVlIGlzIG5vbi1yZWN1cnNpdmUgdG8gYXZvaWQgR0MgaGl0XG4gKiBUaGlzIGRhdGEgc3RydWN0dXJlIHJlcHJlc2VudCBzdGFjayBvZiBlbGVtZW50c1xuICogd2hpY2ggd2UgYXJlIHRyeWluZyB0byBpbnNlcnQgaW50byBxdWFkIHRyZWUuXG4gKi9cbmZ1bmN0aW9uIEluc2VydFN0YWNrICgpIHtcbiAgICB0aGlzLnN0YWNrID0gW107XG4gICAgdGhpcy5wb3BJZHggPSAwO1xufVxuXG5JbnNlcnRTdGFjay5wcm90b3R5cGUgPSB7XG4gICAgaXNFbXB0eTogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnBvcElkeCA9PT0gMDtcbiAgICB9LFxuICAgIHB1c2g6IGZ1bmN0aW9uIChub2RlLCBib2R5KSB7XG4gICAgICAgIHZhciBpdGVtID0gdGhpcy5zdGFja1t0aGlzLnBvcElkeF07XG4gICAgICAgIGlmICghaXRlbSkge1xuICAgICAgICAgICAgLy8gd2UgYXJlIHRyeWluZyB0byBhdm9pZCBtZW1vcnkgcHJlc3N1ZTogY3JlYXRlIG5ldyBlbGVtZW50XG4gICAgICAgICAgICAvLyBvbmx5IHdoZW4gYWJzb2x1dGVseSBuZWNlc3NhcnlcbiAgICAgICAgICAgIHRoaXMuc3RhY2tbdGhpcy5wb3BJZHhdID0gbmV3IEluc2VydFN0YWNrRWxlbWVudChub2RlLCBib2R5KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGl0ZW0ubm9kZSA9IG5vZGU7XG4gICAgICAgICAgICBpdGVtLmJvZHkgPSBib2R5O1xuICAgICAgICB9XG4gICAgICAgICsrdGhpcy5wb3BJZHg7XG4gICAgfSxcbiAgICBwb3A6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgaWYgKHRoaXMucG9wSWR4ID4gMCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3RhY2tbLS10aGlzLnBvcElkeF07XG4gICAgICAgIH1cbiAgICB9LFxuICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHRoaXMucG9wSWR4ID0gMDtcbiAgICB9XG59O1xuXG5mdW5jdGlvbiBJbnNlcnRTdGFja0VsZW1lbnQobm9kZSwgYm9keSkge1xuICAgIHRoaXMubm9kZSA9IG5vZGU7IC8vIFF1YWRUcmVlIG5vZGVcbiAgICB0aGlzLmJvZHkgPSBib2R5OyAvLyBwaHlzaWNhbCBib2R5IHdoaWNoIG5lZWRzIHRvIGJlIGluc2VydGVkIHRvIG5vZGVcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNTYW1lUG9zaXRpb24ocG9pbnQxLCBwb2ludDIpIHtcbiAgICB2YXIgZHggPSBNYXRoLmFicyhwb2ludDEueCAtIHBvaW50Mi54KTtcbiAgICB2YXIgZHkgPSBNYXRoLmFicyhwb2ludDEueSAtIHBvaW50Mi55KTtcblxuICAgIHJldHVybiAoZHggPCAxZS04ICYmIGR5IDwgMWUtOCk7XG59O1xuIiwiLyoqXG4gKiBJbnRlcm5hbCBkYXRhIHN0cnVjdHVyZSB0byByZXByZXNlbnQgMkQgUXVhZFRyZWUgbm9kZVxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIE5vZGUoKSB7XG4gIC8vIGJvZHkgc3RvcmVkIGluc2lkZSB0aGlzIG5vZGUuIEluIHF1YWQgdHJlZSBvbmx5IGxlYWYgbm9kZXMgKGJ5IGNvbnN0cnVjdGlvbilcbiAgLy8gY29udGFpbiBib2lkZXM6XG4gIHRoaXMuYm9keSA9IG51bGw7XG5cbiAgLy8gQ2hpbGQgbm9kZXMgYXJlIHN0b3JlZCBpbiBxdWFkcy4gRWFjaCBxdWFkIGlzIHByZXNlbnRlZCBieSBudW1iZXI6XG4gIC8vIDAgfCAxXG4gIC8vIC0tLS0tXG4gIC8vIDIgfCAzXG4gIHRoaXMucXVhZDAgPSBudWxsO1xuICB0aGlzLnF1YWQxID0gbnVsbDtcbiAgdGhpcy5xdWFkMiA9IG51bGw7XG4gIHRoaXMucXVhZDMgPSBudWxsO1xuXG4gIC8vIFRvdGFsIG1hc3Mgb2YgY3VycmVudCBub2RlXG4gIHRoaXMubWFzcyA9IDA7XG5cbiAgLy8gQ2VudGVyIG9mIG1hc3MgY29vcmRpbmF0ZXNcbiAgdGhpcy5tYXNzWCA9IDA7XG4gIHRoaXMubWFzc1kgPSAwO1xuXG4gIC8vIGJvdW5kaW5nIGJveCBjb29yZGluYXRlc1xuICB0aGlzLmxlZnQgPSAwO1xuICB0aGlzLnRvcCA9IDA7XG4gIHRoaXMuYm90dG9tID0gMDtcbiAgdGhpcy5yaWdodCA9IDA7XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gIHJhbmRvbTogcmFuZG9tLFxuICByYW5kb21JdGVyYXRvcjogcmFuZG9tSXRlcmF0b3Jcbn07XG5cbi8qKlxuICogQ3JlYXRlcyBzZWVkZWQgUFJORyB3aXRoIHR3byBtZXRob2RzOlxuICogICBuZXh0KCkgYW5kIG5leHREb3VibGUoKVxuICovXG5mdW5jdGlvbiByYW5kb20oaW5wdXRTZWVkKSB7XG4gIHZhciBzZWVkID0gdHlwZW9mIGlucHV0U2VlZCA9PT0gJ251bWJlcicgPyBpbnB1dFNlZWQgOiAoKyBuZXcgRGF0ZSgpKTtcbiAgdmFyIHJhbmRvbUZ1bmMgPSBmdW5jdGlvbigpIHtcbiAgICAgIC8vIFJvYmVydCBKZW5raW5zJyAzMiBiaXQgaW50ZWdlciBoYXNoIGZ1bmN0aW9uLlxuICAgICAgc2VlZCA9ICgoc2VlZCArIDB4N2VkNTVkMTYpICsgKHNlZWQgPDwgMTIpKSAgJiAweGZmZmZmZmZmO1xuICAgICAgc2VlZCA9ICgoc2VlZCBeIDB4Yzc2MWMyM2MpIF4gKHNlZWQgPj4+IDE5KSkgJiAweGZmZmZmZmZmO1xuICAgICAgc2VlZCA9ICgoc2VlZCArIDB4MTY1NjY3YjEpICsgKHNlZWQgPDwgNSkpICAgJiAweGZmZmZmZmZmO1xuICAgICAgc2VlZCA9ICgoc2VlZCArIDB4ZDNhMjY0NmMpIF4gKHNlZWQgPDwgOSkpICAgJiAweGZmZmZmZmZmO1xuICAgICAgc2VlZCA9ICgoc2VlZCArIDB4ZmQ3MDQ2YzUpICsgKHNlZWQgPDwgMykpICAgJiAweGZmZmZmZmZmO1xuICAgICAgc2VlZCA9ICgoc2VlZCBeIDB4YjU1YTRmMDkpIF4gKHNlZWQgPj4+IDE2KSkgJiAweGZmZmZmZmZmO1xuICAgICAgcmV0dXJuIChzZWVkICYgMHhmZmZmZmZmKSAvIDB4MTAwMDAwMDA7XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICAgIC8qKlxuICAgICAgICogR2VuZXJhdGVzIHJhbmRvbSBpbnRlZ2VyIG51bWJlciBpbiB0aGUgcmFuZ2UgZnJvbSAwIChpbmNsdXNpdmUpIHRvIG1heFZhbHVlIChleGNsdXNpdmUpXG4gICAgICAgKlxuICAgICAgICogQHBhcmFtIG1heFZhbHVlIE51bWJlciBSRVFVSVJFRC4gT21taXR0aW5nIHRoaXMgbnVtYmVyIHdpbGwgcmVzdWx0IGluIE5hTiB2YWx1ZXMgZnJvbSBQUk5HLlxuICAgICAgICovXG4gICAgICBuZXh0IDogZnVuY3Rpb24gKG1heFZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIE1hdGguZmxvb3IocmFuZG9tRnVuYygpICogbWF4VmFsdWUpO1xuICAgICAgfSxcblxuICAgICAgLyoqXG4gICAgICAgKiBHZW5lcmF0ZXMgcmFuZG9tIGRvdWJsZSBudW1iZXIgaW4gdGhlIHJhbmdlIGZyb20gMCAoaW5jbHVzaXZlKSB0byAxIChleGNsdXNpdmUpXG4gICAgICAgKiBUaGlzIGZ1bmN0aW9uIGlzIHRoZSBzYW1lIGFzIE1hdGgucmFuZG9tKCkgKGV4Y2VwdCB0aGF0IGl0IGNvdWxkIGJlIHNlZWRlZClcbiAgICAgICAqL1xuICAgICAgbmV4dERvdWJsZSA6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZXR1cm4gcmFuZG9tRnVuYygpO1xuICAgICAgfVxuICB9O1xufVxuXG4vKlxuICogQ3JlYXRlcyBpdGVyYXRvciBvdmVyIGFycmF5LCB3aGljaCByZXR1cm5zIGl0ZW1zIG9mIGFycmF5IGluIHJhbmRvbSBvcmRlclxuICogVGltZSBjb21wbGV4aXR5IGlzIGd1YXJhbnRlZWQgdG8gYmUgTyhuKTtcbiAqL1xuZnVuY3Rpb24gcmFuZG9tSXRlcmF0b3IoYXJyYXksIGN1c3RvbVJhbmRvbSkge1xuICAgIHZhciBsb2NhbFJhbmRvbSA9IGN1c3RvbVJhbmRvbSB8fCByYW5kb20oKTtcbiAgICBpZiAodHlwZW9mIGxvY2FsUmFuZG9tLm5leHQgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignY3VzdG9tUmFuZG9tIGRvZXMgbm90IG1hdGNoIGV4cGVjdGVkIEFQSTogbmV4dCgpIGZ1bmN0aW9uIGlzIG1pc3NpbmcnKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBmb3JFYWNoIDogZnVuY3Rpb24gKGNhbGxiYWNrKSB7XG4gICAgICAgICAgICB2YXIgaSwgaiwgdDtcbiAgICAgICAgICAgIGZvciAoaSA9IGFycmF5Lmxlbmd0aCAtIDE7IGkgPiAwOyAtLWkpIHtcbiAgICAgICAgICAgICAgICBqID0gbG9jYWxSYW5kb20ubmV4dChpICsgMSk7IC8vIGkgaW5jbHVzaXZlXG4gICAgICAgICAgICAgICAgdCA9IGFycmF5W2pdO1xuICAgICAgICAgICAgICAgIGFycmF5W2pdID0gYXJyYXlbaV07XG4gICAgICAgICAgICAgICAgYXJyYXlbaV0gPSB0O1xuXG4gICAgICAgICAgICAgICAgY2FsbGJhY2sodCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChhcnJheS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhhcnJheVswXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNodWZmbGVzIGFycmF5IHJhbmRvbWx5LCBpbiBwbGFjZS5cbiAgICAgICAgICovXG4gICAgICAgIHNodWZmbGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaSwgaiwgdDtcbiAgICAgICAgICAgIGZvciAoaSA9IGFycmF5Lmxlbmd0aCAtIDE7IGkgPiAwOyAtLWkpIHtcbiAgICAgICAgICAgICAgICBqID0gbG9jYWxSYW5kb20ubmV4dChpICsgMSk7IC8vIGkgaW5jbHVzaXZlXG4gICAgICAgICAgICAgICAgdCA9IGFycmF5W2pdO1xuICAgICAgICAgICAgICAgIGFycmF5W2pdID0gYXJyYXlbaV07XG4gICAgICAgICAgICAgICAgYXJyYXlbaV0gPSB0O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gYXJyYXk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBzYXZlO1xuXG5mdW5jdGlvbiBzYXZlKGdyYXBoLCBjdXN0b21Ob2RlVHJhbnNmb3JtLCBjdXN0b21MaW5rVHJhbnNmb3JtKSB7XG4gIC8vIE9iamVjdCBjb250YWlucyBgbm9kZXNgIGFuZCBgbGlua3NgIGFycmF5cy5cbiAgdmFyIHJlc3VsdCA9IHtcbiAgICBub2RlczogW10sXG4gICAgbGlua3M6IFtdXG4gIH07XG5cbiAgdmFyIG5vZGVUcmFuc2Zvcm0gPSBjdXN0b21Ob2RlVHJhbnNmb3JtIHx8IGRlZmF1bHRUcmFuc2Zvcm1Gb3JOb2RlO1xuICB2YXIgbGlua1RyYW5zZm9ybSA9IGN1c3RvbUxpbmtUcmFuc2Zvcm0gfHwgZGVmYXVsdFRyYW5zZm9ybUZvckxpbms7XG5cbiAgZ3JhcGguZm9yRWFjaE5vZGUoc2F2ZU5vZGUpO1xuICBncmFwaC5mb3JFYWNoTGluayhzYXZlTGluayk7XG5cbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHJlc3VsdCk7XG5cbiAgZnVuY3Rpb24gc2F2ZU5vZGUobm9kZSkge1xuICAgIC8vIEVhY2ggbm9kZSBvZiB0aGUgZ3JhcGggaXMgcHJvY2Vzc2VkIHRvIHRha2Ugb25seSByZXF1aXJlZCBmaWVsZHNcbiAgICAvLyBgaWRgIGFuZCBgZGF0YWBcbiAgICByZXN1bHQubm9kZXMucHVzaChub2RlVHJhbnNmb3JtKG5vZGUpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNhdmVMaW5rKGxpbmspIHtcbiAgICAvLyBFYWNoIGxpbmsgb2YgdGhlIGdyYXBoIGlzIGFsc28gcHJvY2Vzc2VkIHRvIHRha2UgYGZyb21JZGAsIGB0b0lkYCBhbmRcbiAgICAvLyBgZGF0YWBcbiAgICByZXN1bHQubGlua3MucHVzaChsaW5rVHJhbnNmb3JtKGxpbmspKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGRlZmF1bHRUcmFuc2Zvcm1Gb3JOb2RlKG5vZGUpIHtcbiAgICB2YXIgcmVzdWx0ID0ge1xuICAgICAgaWQ6IG5vZGUuaWRcbiAgICB9O1xuICAgIC8vIFdlIGRvbid0IHdhbnQgdG8gc3RvcmUgdW5kZWZpbmVkIGZpZWxkcyB3aGVuIGl0J3Mgbm90IG5lY2Vzc2FyeTpcbiAgICBpZiAobm9kZS5kYXRhICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlc3VsdC5kYXRhID0gbm9kZS5kYXRhO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBmdW5jdGlvbiBkZWZhdWx0VHJhbnNmb3JtRm9yTGluayhsaW5rKSB7XG4gICAgdmFyIHJlc3VsdCA9IHtcbiAgICAgIGZyb21JZDogbGluay5mcm9tSWQsXG4gICAgICB0b0lkOiBsaW5rLnRvSWQsXG4gICAgfTtcblxuICAgIGlmIChsaW5rLmRhdGEgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVzdWx0LmRhdGEgPSBsaW5rLmRhdGE7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufVxuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCIvLyAgICAgVW5kZXJzY29yZS5qcyAxLjguM1xuLy8gICAgIGh0dHA6Ly91bmRlcnNjb3JlanMub3JnXG4vLyAgICAgKGMpIDIwMDktMjAxNSBKZXJlbXkgQXNoa2VuYXMsIERvY3VtZW50Q2xvdWQgYW5kIEludmVzdGlnYXRpdmUgUmVwb3J0ZXJzICYgRWRpdG9yc1xuLy8gICAgIFVuZGVyc2NvcmUgbWF5IGJlIGZyZWVseSBkaXN0cmlidXRlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UuXG5cbihmdW5jdGlvbigpIHtcblxuICAvLyBCYXNlbGluZSBzZXR1cFxuICAvLyAtLS0tLS0tLS0tLS0tLVxuXG4gIC8vIEVzdGFibGlzaCB0aGUgcm9vdCBvYmplY3QsIGB3aW5kb3dgIGluIHRoZSBicm93c2VyLCBvciBgZXhwb3J0c2Agb24gdGhlIHNlcnZlci5cbiAgdmFyIHJvb3QgPSB0aGlzO1xuXG4gIC8vIFNhdmUgdGhlIHByZXZpb3VzIHZhbHVlIG9mIHRoZSBgX2AgdmFyaWFibGUuXG4gIHZhciBwcmV2aW91c1VuZGVyc2NvcmUgPSByb290Ll87XG5cbiAgLy8gU2F2ZSBieXRlcyBpbiB0aGUgbWluaWZpZWQgKGJ1dCBub3QgZ3ppcHBlZCkgdmVyc2lvbjpcbiAgdmFyIEFycmF5UHJvdG8gPSBBcnJheS5wcm90b3R5cGUsIE9ialByb3RvID0gT2JqZWN0LnByb3RvdHlwZSwgRnVuY1Byb3RvID0gRnVuY3Rpb24ucHJvdG90eXBlO1xuXG4gIC8vIENyZWF0ZSBxdWljayByZWZlcmVuY2UgdmFyaWFibGVzIGZvciBzcGVlZCBhY2Nlc3MgdG8gY29yZSBwcm90b3R5cGVzLlxuICB2YXJcbiAgICBwdXNoICAgICAgICAgICAgID0gQXJyYXlQcm90by5wdXNoLFxuICAgIHNsaWNlICAgICAgICAgICAgPSBBcnJheVByb3RvLnNsaWNlLFxuICAgIHRvU3RyaW5nICAgICAgICAgPSBPYmpQcm90by50b1N0cmluZyxcbiAgICBoYXNPd25Qcm9wZXJ0eSAgID0gT2JqUHJvdG8uaGFzT3duUHJvcGVydHk7XG5cbiAgLy8gQWxsICoqRUNNQVNjcmlwdCA1KiogbmF0aXZlIGZ1bmN0aW9uIGltcGxlbWVudGF0aW9ucyB0aGF0IHdlIGhvcGUgdG8gdXNlXG4gIC8vIGFyZSBkZWNsYXJlZCBoZXJlLlxuICB2YXJcbiAgICBuYXRpdmVJc0FycmF5ICAgICAgPSBBcnJheS5pc0FycmF5LFxuICAgIG5hdGl2ZUtleXMgICAgICAgICA9IE9iamVjdC5rZXlzLFxuICAgIG5hdGl2ZUJpbmQgICAgICAgICA9IEZ1bmNQcm90by5iaW5kLFxuICAgIG5hdGl2ZUNyZWF0ZSAgICAgICA9IE9iamVjdC5jcmVhdGU7XG5cbiAgLy8gTmFrZWQgZnVuY3Rpb24gcmVmZXJlbmNlIGZvciBzdXJyb2dhdGUtcHJvdG90eXBlLXN3YXBwaW5nLlxuICB2YXIgQ3RvciA9IGZ1bmN0aW9uKCl7fTtcblxuICAvLyBDcmVhdGUgYSBzYWZlIHJlZmVyZW5jZSB0byB0aGUgVW5kZXJzY29yZSBvYmplY3QgZm9yIHVzZSBiZWxvdy5cbiAgdmFyIF8gPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAob2JqIGluc3RhbmNlb2YgXykgcmV0dXJuIG9iajtcbiAgICBpZiAoISh0aGlzIGluc3RhbmNlb2YgXykpIHJldHVybiBuZXcgXyhvYmopO1xuICAgIHRoaXMuX3dyYXBwZWQgPSBvYmo7XG4gIH07XG5cbiAgLy8gRXhwb3J0IHRoZSBVbmRlcnNjb3JlIG9iamVjdCBmb3IgKipOb2RlLmpzKiosIHdpdGhcbiAgLy8gYmFja3dhcmRzLWNvbXBhdGliaWxpdHkgZm9yIHRoZSBvbGQgYHJlcXVpcmUoKWAgQVBJLiBJZiB3ZSdyZSBpblxuICAvLyB0aGUgYnJvd3NlciwgYWRkIGBfYCBhcyBhIGdsb2JhbCBvYmplY3QuXG4gIGlmICh0eXBlb2YgZXhwb3J0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAodHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcbiAgICAgIGV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IF87XG4gICAgfVxuICAgIGV4cG9ydHMuXyA9IF87XG4gIH0gZWxzZSB7XG4gICAgcm9vdC5fID0gXztcbiAgfVxuXG4gIC8vIEN1cnJlbnQgdmVyc2lvbi5cbiAgXy5WRVJTSU9OID0gJzEuOC4zJztcblxuICAvLyBJbnRlcm5hbCBmdW5jdGlvbiB0aGF0IHJldHVybnMgYW4gZWZmaWNpZW50IChmb3IgY3VycmVudCBlbmdpbmVzKSB2ZXJzaW9uXG4gIC8vIG9mIHRoZSBwYXNzZWQtaW4gY2FsbGJhY2ssIHRvIGJlIHJlcGVhdGVkbHkgYXBwbGllZCBpbiBvdGhlciBVbmRlcnNjb3JlXG4gIC8vIGZ1bmN0aW9ucy5cbiAgdmFyIG9wdGltaXplQ2IgPSBmdW5jdGlvbihmdW5jLCBjb250ZXh0LCBhcmdDb3VudCkge1xuICAgIGlmIChjb250ZXh0ID09PSB2b2lkIDApIHJldHVybiBmdW5jO1xuICAgIHN3aXRjaCAoYXJnQ291bnQgPT0gbnVsbCA/IDMgOiBhcmdDb3VudCkge1xuICAgICAgY2FzZSAxOiByZXR1cm4gZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmMuY2FsbChjb250ZXh0LCB2YWx1ZSk7XG4gICAgICB9O1xuICAgICAgY2FzZSAyOiByZXR1cm4gZnVuY3Rpb24odmFsdWUsIG90aGVyKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmNhbGwoY29udGV4dCwgdmFsdWUsIG90aGVyKTtcbiAgICAgIH07XG4gICAgICBjYXNlIDM6IHJldHVybiBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGNvbGxlY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuIGZ1bmMuY2FsbChjb250ZXh0LCB2YWx1ZSwgaW5kZXgsIGNvbGxlY3Rpb24pO1xuICAgICAgfTtcbiAgICAgIGNhc2UgNDogcmV0dXJuIGZ1bmN0aW9uKGFjY3VtdWxhdG9yLCB2YWx1ZSwgaW5kZXgsIGNvbGxlY3Rpb24pIHtcbiAgICAgICAgcmV0dXJuIGZ1bmMuY2FsbChjb250ZXh0LCBhY2N1bXVsYXRvciwgdmFsdWUsIGluZGV4LCBjb2xsZWN0aW9uKTtcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfTtcblxuICAvLyBBIG1vc3RseS1pbnRlcm5hbCBmdW5jdGlvbiB0byBnZW5lcmF0ZSBjYWxsYmFja3MgdGhhdCBjYW4gYmUgYXBwbGllZFxuICAvLyB0byBlYWNoIGVsZW1lbnQgaW4gYSBjb2xsZWN0aW9uLCByZXR1cm5pbmcgdGhlIGRlc2lyZWQgcmVzdWx0IOKAlCBlaXRoZXJcbiAgLy8gaWRlbnRpdHksIGFuIGFyYml0cmFyeSBjYWxsYmFjaywgYSBwcm9wZXJ0eSBtYXRjaGVyLCBvciBhIHByb3BlcnR5IGFjY2Vzc29yLlxuICB2YXIgY2IgPSBmdW5jdGlvbih2YWx1ZSwgY29udGV4dCwgYXJnQ291bnQpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIF8uaWRlbnRpdHk7XG4gICAgaWYgKF8uaXNGdW5jdGlvbih2YWx1ZSkpIHJldHVybiBvcHRpbWl6ZUNiKHZhbHVlLCBjb250ZXh0LCBhcmdDb3VudCk7XG4gICAgaWYgKF8uaXNPYmplY3QodmFsdWUpKSByZXR1cm4gXy5tYXRjaGVyKHZhbHVlKTtcbiAgICByZXR1cm4gXy5wcm9wZXJ0eSh2YWx1ZSk7XG4gIH07XG4gIF8uaXRlcmF0ZWUgPSBmdW5jdGlvbih2YWx1ZSwgY29udGV4dCkge1xuICAgIHJldHVybiBjYih2YWx1ZSwgY29udGV4dCwgSW5maW5pdHkpO1xuICB9O1xuXG4gIC8vIEFuIGludGVybmFsIGZ1bmN0aW9uIGZvciBjcmVhdGluZyBhc3NpZ25lciBmdW5jdGlvbnMuXG4gIHZhciBjcmVhdGVBc3NpZ25lciA9IGZ1bmN0aW9uKGtleXNGdW5jLCB1bmRlZmluZWRPbmx5KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKG9iaikge1xuICAgICAgdmFyIGxlbmd0aCA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgICBpZiAobGVuZ3RoIDwgMiB8fCBvYmogPT0gbnVsbCkgcmV0dXJuIG9iajtcbiAgICAgIGZvciAodmFyIGluZGV4ID0gMTsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgdmFyIHNvdXJjZSA9IGFyZ3VtZW50c1tpbmRleF0sXG4gICAgICAgICAgICBrZXlzID0ga2V5c0Z1bmMoc291cmNlKSxcbiAgICAgICAgICAgIGwgPSBrZXlzLmxlbmd0aDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICAgICAgICBpZiAoIXVuZGVmaW5lZE9ubHkgfHwgb2JqW2tleV0gPT09IHZvaWQgMCkgb2JqW2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIG9iajtcbiAgICB9O1xuICB9O1xuXG4gIC8vIEFuIGludGVybmFsIGZ1bmN0aW9uIGZvciBjcmVhdGluZyBhIG5ldyBvYmplY3QgdGhhdCBpbmhlcml0cyBmcm9tIGFub3RoZXIuXG4gIHZhciBiYXNlQ3JlYXRlID0gZnVuY3Rpb24ocHJvdG90eXBlKSB7XG4gICAgaWYgKCFfLmlzT2JqZWN0KHByb3RvdHlwZSkpIHJldHVybiB7fTtcbiAgICBpZiAobmF0aXZlQ3JlYXRlKSByZXR1cm4gbmF0aXZlQ3JlYXRlKHByb3RvdHlwZSk7XG4gICAgQ3Rvci5wcm90b3R5cGUgPSBwcm90b3R5cGU7XG4gICAgdmFyIHJlc3VsdCA9IG5ldyBDdG9yO1xuICAgIEN0b3IucHJvdG90eXBlID0gbnVsbDtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIHZhciBwcm9wZXJ0eSA9IGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiBmdW5jdGlvbihvYmopIHtcbiAgICAgIHJldHVybiBvYmogPT0gbnVsbCA/IHZvaWQgMCA6IG9ialtrZXldO1xuICAgIH07XG4gIH07XG5cbiAgLy8gSGVscGVyIGZvciBjb2xsZWN0aW9uIG1ldGhvZHMgdG8gZGV0ZXJtaW5lIHdoZXRoZXIgYSBjb2xsZWN0aW9uXG4gIC8vIHNob3VsZCBiZSBpdGVyYXRlZCBhcyBhbiBhcnJheSBvciBhcyBhbiBvYmplY3RcbiAgLy8gUmVsYXRlZDogaHR0cDovL3Blb3BsZS5tb3ppbGxhLm9yZy9+am9yZW5kb3JmZi9lczYtZHJhZnQuaHRtbCNzZWMtdG9sZW5ndGhcbiAgLy8gQXZvaWRzIGEgdmVyeSBuYXN0eSBpT1MgOCBKSVQgYnVnIG9uIEFSTS02NC4gIzIwOTRcbiAgdmFyIE1BWF9BUlJBWV9JTkRFWCA9IE1hdGgucG93KDIsIDUzKSAtIDE7XG4gIHZhciBnZXRMZW5ndGggPSBwcm9wZXJ0eSgnbGVuZ3RoJyk7XG4gIHZhciBpc0FycmF5TGlrZSA9IGZ1bmN0aW9uKGNvbGxlY3Rpb24pIHtcbiAgICB2YXIgbGVuZ3RoID0gZ2V0TGVuZ3RoKGNvbGxlY3Rpb24pO1xuICAgIHJldHVybiB0eXBlb2YgbGVuZ3RoID09ICdudW1iZXInICYmIGxlbmd0aCA+PSAwICYmIGxlbmd0aCA8PSBNQVhfQVJSQVlfSU5ERVg7XG4gIH07XG5cbiAgLy8gQ29sbGVjdGlvbiBGdW5jdGlvbnNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvLyBUaGUgY29ybmVyc3RvbmUsIGFuIGBlYWNoYCBpbXBsZW1lbnRhdGlvbiwgYWthIGBmb3JFYWNoYC5cbiAgLy8gSGFuZGxlcyByYXcgb2JqZWN0cyBpbiBhZGRpdGlvbiB0byBhcnJheS1saWtlcy4gVHJlYXRzIGFsbFxuICAvLyBzcGFyc2UgYXJyYXktbGlrZXMgYXMgaWYgdGhleSB3ZXJlIGRlbnNlLlxuICBfLmVhY2ggPSBfLmZvckVhY2ggPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaXRlcmF0ZWUgPSBvcHRpbWl6ZUNiKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICB2YXIgaSwgbGVuZ3RoO1xuICAgIGlmIChpc0FycmF5TGlrZShvYmopKSB7XG4gICAgICBmb3IgKGkgPSAwLCBsZW5ndGggPSBvYmoubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaXRlcmF0ZWUob2JqW2ldLCBpLCBvYmopO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIga2V5cyA9IF8ua2V5cyhvYmopO1xuICAgICAgZm9yIChpID0gMCwgbGVuZ3RoID0ga2V5cy5sZW5ndGg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICBpdGVyYXRlZShvYmpba2V5c1tpXV0sIGtleXNbaV0sIG9iaik7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvYmo7XG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSByZXN1bHRzIG9mIGFwcGx5aW5nIHRoZSBpdGVyYXRlZSB0byBlYWNoIGVsZW1lbnQuXG4gIF8ubWFwID0gXy5jb2xsZWN0ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIGl0ZXJhdGVlID0gY2IoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgIHZhciBrZXlzID0gIWlzQXJyYXlMaWtlKG9iaikgJiYgXy5rZXlzKG9iaiksXG4gICAgICAgIGxlbmd0aCA9IChrZXlzIHx8IG9iaikubGVuZ3RoLFxuICAgICAgICByZXN1bHRzID0gQXJyYXkobGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpbmRleCA9IDA7IGluZGV4IDwgbGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICB2YXIgY3VycmVudEtleSA9IGtleXMgPyBrZXlzW2luZGV4XSA6IGluZGV4O1xuICAgICAgcmVzdWx0c1tpbmRleF0gPSBpdGVyYXRlZShvYmpbY3VycmVudEtleV0sIGN1cnJlbnRLZXksIG9iaik7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHRzO1xuICB9O1xuXG4gIC8vIENyZWF0ZSBhIHJlZHVjaW5nIGZ1bmN0aW9uIGl0ZXJhdGluZyBsZWZ0IG9yIHJpZ2h0LlxuICBmdW5jdGlvbiBjcmVhdGVSZWR1Y2UoZGlyKSB7XG4gICAgLy8gT3B0aW1pemVkIGl0ZXJhdG9yIGZ1bmN0aW9uIGFzIHVzaW5nIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAvLyBpbiB0aGUgbWFpbiBmdW5jdGlvbiB3aWxsIGRlb3B0aW1pemUgdGhlLCBzZWUgIzE5OTEuXG4gICAgZnVuY3Rpb24gaXRlcmF0b3Iob2JqLCBpdGVyYXRlZSwgbWVtbywga2V5cywgaW5kZXgsIGxlbmd0aCkge1xuICAgICAgZm9yICg7IGluZGV4ID49IDAgJiYgaW5kZXggPCBsZW5ndGg7IGluZGV4ICs9IGRpcikge1xuICAgICAgICB2YXIgY3VycmVudEtleSA9IGtleXMgPyBrZXlzW2luZGV4XSA6IGluZGV4O1xuICAgICAgICBtZW1vID0gaXRlcmF0ZWUobWVtbywgb2JqW2N1cnJlbnRLZXldLCBjdXJyZW50S2V5LCBvYmopO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG1lbW87XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIG1lbW8sIGNvbnRleHQpIHtcbiAgICAgIGl0ZXJhdGVlID0gb3B0aW1pemVDYihpdGVyYXRlZSwgY29udGV4dCwgNCk7XG4gICAgICB2YXIga2V5cyA9ICFpc0FycmF5TGlrZShvYmopICYmIF8ua2V5cyhvYmopLFxuICAgICAgICAgIGxlbmd0aCA9IChrZXlzIHx8IG9iaikubGVuZ3RoLFxuICAgICAgICAgIGluZGV4ID0gZGlyID4gMCA/IDAgOiBsZW5ndGggLSAxO1xuICAgICAgLy8gRGV0ZXJtaW5lIHRoZSBpbml0aWFsIHZhbHVlIGlmIG5vbmUgaXMgcHJvdmlkZWQuXG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDMpIHtcbiAgICAgICAgbWVtbyA9IG9ialtrZXlzID8ga2V5c1tpbmRleF0gOiBpbmRleF07XG4gICAgICAgIGluZGV4ICs9IGRpcjtcbiAgICAgIH1cbiAgICAgIHJldHVybiBpdGVyYXRvcihvYmosIGl0ZXJhdGVlLCBtZW1vLCBrZXlzLCBpbmRleCwgbGVuZ3RoKTtcbiAgICB9O1xuICB9XG5cbiAgLy8gKipSZWR1Y2UqKiBidWlsZHMgdXAgYSBzaW5nbGUgcmVzdWx0IGZyb20gYSBsaXN0IG9mIHZhbHVlcywgYWthIGBpbmplY3RgLFxuICAvLyBvciBgZm9sZGxgLlxuICBfLnJlZHVjZSA9IF8uZm9sZGwgPSBfLmluamVjdCA9IGNyZWF0ZVJlZHVjZSgxKTtcblxuICAvLyBUaGUgcmlnaHQtYXNzb2NpYXRpdmUgdmVyc2lvbiBvZiByZWR1Y2UsIGFsc28ga25vd24gYXMgYGZvbGRyYC5cbiAgXy5yZWR1Y2VSaWdodCA9IF8uZm9sZHIgPSBjcmVhdGVSZWR1Y2UoLTEpO1xuXG4gIC8vIFJldHVybiB0aGUgZmlyc3QgdmFsdWUgd2hpY2ggcGFzc2VzIGEgdHJ1dGggdGVzdC4gQWxpYXNlZCBhcyBgZGV0ZWN0YC5cbiAgXy5maW5kID0gXy5kZXRlY3QgPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHZhciBrZXk7XG4gICAgaWYgKGlzQXJyYXlMaWtlKG9iaikpIHtcbiAgICAgIGtleSA9IF8uZmluZEluZGV4KG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KTtcbiAgICB9IGVsc2Uge1xuICAgICAga2V5ID0gXy5maW5kS2V5KG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KTtcbiAgICB9XG4gICAgaWYgKGtleSAhPT0gdm9pZCAwICYmIGtleSAhPT0gLTEpIHJldHVybiBvYmpba2V5XTtcbiAgfTtcblxuICAvLyBSZXR1cm4gYWxsIHRoZSBlbGVtZW50cyB0aGF0IHBhc3MgYSB0cnV0aCB0ZXN0LlxuICAvLyBBbGlhc2VkIGFzIGBzZWxlY3RgLlxuICBfLmZpbHRlciA9IF8uc2VsZWN0ID0gZnVuY3Rpb24ob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpIHtcbiAgICB2YXIgcmVzdWx0cyA9IFtdO1xuICAgIHByZWRpY2F0ZSA9IGNiKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgXy5lYWNoKG9iaiwgZnVuY3Rpb24odmFsdWUsIGluZGV4LCBsaXN0KSB7XG4gICAgICBpZiAocHJlZGljYXRlKHZhbHVlLCBpbmRleCwgbGlzdCkpIHJlc3VsdHMucHVzaCh2YWx1ZSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH07XG5cbiAgLy8gUmV0dXJuIGFsbCB0aGUgZWxlbWVudHMgZm9yIHdoaWNoIGEgdHJ1dGggdGVzdCBmYWlscy5cbiAgXy5yZWplY3QgPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHJldHVybiBfLmZpbHRlcihvYmosIF8ubmVnYXRlKGNiKHByZWRpY2F0ZSkpLCBjb250ZXh0KTtcbiAgfTtcblxuICAvLyBEZXRlcm1pbmUgd2hldGhlciBhbGwgb2YgdGhlIGVsZW1lbnRzIG1hdGNoIGEgdHJ1dGggdGVzdC5cbiAgLy8gQWxpYXNlZCBhcyBgYWxsYC5cbiAgXy5ldmVyeSA9IF8uYWxsID0gZnVuY3Rpb24ob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpIHtcbiAgICBwcmVkaWNhdGUgPSBjYihwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIHZhciBrZXlzID0gIWlzQXJyYXlMaWtlKG9iaikgJiYgXy5rZXlzKG9iaiksXG4gICAgICAgIGxlbmd0aCA9IChrZXlzIHx8IG9iaikubGVuZ3RoO1xuICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIHZhciBjdXJyZW50S2V5ID0ga2V5cyA/IGtleXNbaW5kZXhdIDogaW5kZXg7XG4gICAgICBpZiAoIXByZWRpY2F0ZShvYmpbY3VycmVudEtleV0sIGN1cnJlbnRLZXksIG9iaikpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cbiAgLy8gRGV0ZXJtaW5lIGlmIGF0IGxlYXN0IG9uZSBlbGVtZW50IGluIHRoZSBvYmplY3QgbWF0Y2hlcyBhIHRydXRoIHRlc3QuXG4gIC8vIEFsaWFzZWQgYXMgYGFueWAuXG4gIF8uc29tZSA9IF8uYW55ID0gZnVuY3Rpb24ob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpIHtcbiAgICBwcmVkaWNhdGUgPSBjYihwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIHZhciBrZXlzID0gIWlzQXJyYXlMaWtlKG9iaikgJiYgXy5rZXlzKG9iaiksXG4gICAgICAgIGxlbmd0aCA9IChrZXlzIHx8IG9iaikubGVuZ3RoO1xuICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIHZhciBjdXJyZW50S2V5ID0ga2V5cyA/IGtleXNbaW5kZXhdIDogaW5kZXg7XG4gICAgICBpZiAocHJlZGljYXRlKG9ialtjdXJyZW50S2V5XSwgY3VycmVudEtleSwgb2JqKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICAvLyBEZXRlcm1pbmUgaWYgdGhlIGFycmF5IG9yIG9iamVjdCBjb250YWlucyBhIGdpdmVuIGl0ZW0gKHVzaW5nIGA9PT1gKS5cbiAgLy8gQWxpYXNlZCBhcyBgaW5jbHVkZXNgIGFuZCBgaW5jbHVkZWAuXG4gIF8uY29udGFpbnMgPSBfLmluY2x1ZGVzID0gXy5pbmNsdWRlID0gZnVuY3Rpb24ob2JqLCBpdGVtLCBmcm9tSW5kZXgsIGd1YXJkKSB7XG4gICAgaWYgKCFpc0FycmF5TGlrZShvYmopKSBvYmogPSBfLnZhbHVlcyhvYmopO1xuICAgIGlmICh0eXBlb2YgZnJvbUluZGV4ICE9ICdudW1iZXInIHx8IGd1YXJkKSBmcm9tSW5kZXggPSAwO1xuICAgIHJldHVybiBfLmluZGV4T2Yob2JqLCBpdGVtLCBmcm9tSW5kZXgpID49IDA7XG4gIH07XG5cbiAgLy8gSW52b2tlIGEgbWV0aG9kICh3aXRoIGFyZ3VtZW50cykgb24gZXZlcnkgaXRlbSBpbiBhIGNvbGxlY3Rpb24uXG4gIF8uaW52b2tlID0gZnVuY3Rpb24ob2JqLCBtZXRob2QpIHtcbiAgICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgICB2YXIgaXNGdW5jID0gXy5pc0Z1bmN0aW9uKG1ldGhvZCk7XG4gICAgcmV0dXJuIF8ubWFwKG9iaiwgZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIHZhciBmdW5jID0gaXNGdW5jID8gbWV0aG9kIDogdmFsdWVbbWV0aG9kXTtcbiAgICAgIHJldHVybiBmdW5jID09IG51bGwgPyBmdW5jIDogZnVuYy5hcHBseSh2YWx1ZSwgYXJncyk7XG4gICAgfSk7XG4gIH07XG5cbiAgLy8gQ29udmVuaWVuY2UgdmVyc2lvbiBvZiBhIGNvbW1vbiB1c2UgY2FzZSBvZiBgbWFwYDogZmV0Y2hpbmcgYSBwcm9wZXJ0eS5cbiAgXy5wbHVjayA9IGZ1bmN0aW9uKG9iaiwga2V5KSB7XG4gICAgcmV0dXJuIF8ubWFwKG9iaiwgXy5wcm9wZXJ0eShrZXkpKTtcbiAgfTtcblxuICAvLyBDb252ZW5pZW5jZSB2ZXJzaW9uIG9mIGEgY29tbW9uIHVzZSBjYXNlIG9mIGBmaWx0ZXJgOiBzZWxlY3Rpbmcgb25seSBvYmplY3RzXG4gIC8vIGNvbnRhaW5pbmcgc3BlY2lmaWMgYGtleTp2YWx1ZWAgcGFpcnMuXG4gIF8ud2hlcmUgPSBmdW5jdGlvbihvYmosIGF0dHJzKSB7XG4gICAgcmV0dXJuIF8uZmlsdGVyKG9iaiwgXy5tYXRjaGVyKGF0dHJzKSk7XG4gIH07XG5cbiAgLy8gQ29udmVuaWVuY2UgdmVyc2lvbiBvZiBhIGNvbW1vbiB1c2UgY2FzZSBvZiBgZmluZGA6IGdldHRpbmcgdGhlIGZpcnN0IG9iamVjdFxuICAvLyBjb250YWluaW5nIHNwZWNpZmljIGBrZXk6dmFsdWVgIHBhaXJzLlxuICBfLmZpbmRXaGVyZSA9IGZ1bmN0aW9uKG9iaiwgYXR0cnMpIHtcbiAgICByZXR1cm4gXy5maW5kKG9iaiwgXy5tYXRjaGVyKGF0dHJzKSk7XG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSBtYXhpbXVtIGVsZW1lbnQgKG9yIGVsZW1lbnQtYmFzZWQgY29tcHV0YXRpb24pLlxuICBfLm1heCA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICB2YXIgcmVzdWx0ID0gLUluZmluaXR5LCBsYXN0Q29tcHV0ZWQgPSAtSW5maW5pdHksXG4gICAgICAgIHZhbHVlLCBjb21wdXRlZDtcbiAgICBpZiAoaXRlcmF0ZWUgPT0gbnVsbCAmJiBvYmogIT0gbnVsbCkge1xuICAgICAgb2JqID0gaXNBcnJheUxpa2Uob2JqKSA/IG9iaiA6IF8udmFsdWVzKG9iaik7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0gb2JqLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhbHVlID0gb2JqW2ldO1xuICAgICAgICBpZiAodmFsdWUgPiByZXN1bHQpIHtcbiAgICAgICAgICByZXN1bHQgPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpdGVyYXRlZSA9IGNiKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICAgIF8uZWFjaChvYmosIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgbGlzdCkge1xuICAgICAgICBjb21wdXRlZCA9IGl0ZXJhdGVlKHZhbHVlLCBpbmRleCwgbGlzdCk7XG4gICAgICAgIGlmIChjb21wdXRlZCA+IGxhc3RDb21wdXRlZCB8fCBjb21wdXRlZCA9PT0gLUluZmluaXR5ICYmIHJlc3VsdCA9PT0gLUluZmluaXR5KSB7XG4gICAgICAgICAgcmVzdWx0ID0gdmFsdWU7XG4gICAgICAgICAgbGFzdENvbXB1dGVkID0gY29tcHV0ZWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIFJldHVybiB0aGUgbWluaW11bSBlbGVtZW50IChvciBlbGVtZW50LWJhc2VkIGNvbXB1dGF0aW9uKS5cbiAgXy5taW4gPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgdmFyIHJlc3VsdCA9IEluZmluaXR5LCBsYXN0Q29tcHV0ZWQgPSBJbmZpbml0eSxcbiAgICAgICAgdmFsdWUsIGNvbXB1dGVkO1xuICAgIGlmIChpdGVyYXRlZSA9PSBudWxsICYmIG9iaiAhPSBudWxsKSB7XG4gICAgICBvYmogPSBpc0FycmF5TGlrZShvYmopID8gb2JqIDogXy52YWx1ZXMob2JqKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBvYmoubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFsdWUgPSBvYmpbaV07XG4gICAgICAgIGlmICh2YWx1ZSA8IHJlc3VsdCkge1xuICAgICAgICAgIHJlc3VsdCA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGl0ZXJhdGVlID0gY2IoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgICAgXy5lYWNoKG9iaiwgZnVuY3Rpb24odmFsdWUsIGluZGV4LCBsaXN0KSB7XG4gICAgICAgIGNvbXB1dGVkID0gaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBsaXN0KTtcbiAgICAgICAgaWYgKGNvbXB1dGVkIDwgbGFzdENvbXB1dGVkIHx8IGNvbXB1dGVkID09PSBJbmZpbml0eSAmJiByZXN1bHQgPT09IEluZmluaXR5KSB7XG4gICAgICAgICAgcmVzdWx0ID0gdmFsdWU7XG4gICAgICAgICAgbGFzdENvbXB1dGVkID0gY29tcHV0ZWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIFNodWZmbGUgYSBjb2xsZWN0aW9uLCB1c2luZyB0aGUgbW9kZXJuIHZlcnNpb24gb2YgdGhlXG4gIC8vIFtGaXNoZXItWWF0ZXMgc2h1ZmZsZV0oaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9GaXNoZXLigJNZYXRlc19zaHVmZmxlKS5cbiAgXy5zaHVmZmxlID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIHNldCA9IGlzQXJyYXlMaWtlKG9iaikgPyBvYmogOiBfLnZhbHVlcyhvYmopO1xuICAgIHZhciBsZW5ndGggPSBzZXQubGVuZ3RoO1xuICAgIHZhciBzaHVmZmxlZCA9IEFycmF5KGxlbmd0aCk7XG4gICAgZm9yICh2YXIgaW5kZXggPSAwLCByYW5kOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgcmFuZCA9IF8ucmFuZG9tKDAsIGluZGV4KTtcbiAgICAgIGlmIChyYW5kICE9PSBpbmRleCkgc2h1ZmZsZWRbaW5kZXhdID0gc2h1ZmZsZWRbcmFuZF07XG4gICAgICBzaHVmZmxlZFtyYW5kXSA9IHNldFtpbmRleF07XG4gICAgfVxuICAgIHJldHVybiBzaHVmZmxlZDtcbiAgfTtcblxuICAvLyBTYW1wbGUgKipuKiogcmFuZG9tIHZhbHVlcyBmcm9tIGEgY29sbGVjdGlvbi5cbiAgLy8gSWYgKipuKiogaXMgbm90IHNwZWNpZmllZCwgcmV0dXJucyBhIHNpbmdsZSByYW5kb20gZWxlbWVudC5cbiAgLy8gVGhlIGludGVybmFsIGBndWFyZGAgYXJndW1lbnQgYWxsb3dzIGl0IHRvIHdvcmsgd2l0aCBgbWFwYC5cbiAgXy5zYW1wbGUgPSBmdW5jdGlvbihvYmosIG4sIGd1YXJkKSB7XG4gICAgaWYgKG4gPT0gbnVsbCB8fCBndWFyZCkge1xuICAgICAgaWYgKCFpc0FycmF5TGlrZShvYmopKSBvYmogPSBfLnZhbHVlcyhvYmopO1xuICAgICAgcmV0dXJuIG9ialtfLnJhbmRvbShvYmoubGVuZ3RoIC0gMSldO1xuICAgIH1cbiAgICByZXR1cm4gXy5zaHVmZmxlKG9iaikuc2xpY2UoMCwgTWF0aC5tYXgoMCwgbikpO1xuICB9O1xuXG4gIC8vIFNvcnQgdGhlIG9iamVjdCdzIHZhbHVlcyBieSBhIGNyaXRlcmlvbiBwcm9kdWNlZCBieSBhbiBpdGVyYXRlZS5cbiAgXy5zb3J0QnkgPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaXRlcmF0ZWUgPSBjYihpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgcmV0dXJuIF8ucGx1Y2soXy5tYXAob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGxpc3QpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgICAgaW5kZXg6IGluZGV4LFxuICAgICAgICBjcml0ZXJpYTogaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBsaXN0KVxuICAgICAgfTtcbiAgICB9KS5zb3J0KGZ1bmN0aW9uKGxlZnQsIHJpZ2h0KSB7XG4gICAgICB2YXIgYSA9IGxlZnQuY3JpdGVyaWE7XG4gICAgICB2YXIgYiA9IHJpZ2h0LmNyaXRlcmlhO1xuICAgICAgaWYgKGEgIT09IGIpIHtcbiAgICAgICAgaWYgKGEgPiBiIHx8IGEgPT09IHZvaWQgMCkgcmV0dXJuIDE7XG4gICAgICAgIGlmIChhIDwgYiB8fCBiID09PSB2b2lkIDApIHJldHVybiAtMTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBsZWZ0LmluZGV4IC0gcmlnaHQuaW5kZXg7XG4gICAgfSksICd2YWx1ZScpO1xuICB9O1xuXG4gIC8vIEFuIGludGVybmFsIGZ1bmN0aW9uIHVzZWQgZm9yIGFnZ3JlZ2F0ZSBcImdyb3VwIGJ5XCIgb3BlcmF0aW9ucy5cbiAgdmFyIGdyb3VwID0gZnVuY3Rpb24oYmVoYXZpb3IpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgICAgaXRlcmF0ZWUgPSBjYihpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgICBfLmVhY2gob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgpIHtcbiAgICAgICAgdmFyIGtleSA9IGl0ZXJhdGVlKHZhbHVlLCBpbmRleCwgb2JqKTtcbiAgICAgICAgYmVoYXZpb3IocmVzdWx0LCB2YWx1ZSwga2V5KTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9O1xuXG4gIC8vIEdyb3VwcyB0aGUgb2JqZWN0J3MgdmFsdWVzIGJ5IGEgY3JpdGVyaW9uLiBQYXNzIGVpdGhlciBhIHN0cmluZyBhdHRyaWJ1dGVcbiAgLy8gdG8gZ3JvdXAgYnksIG9yIGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIHRoZSBjcml0ZXJpb24uXG4gIF8uZ3JvdXBCeSA9IGdyb3VwKGZ1bmN0aW9uKHJlc3VsdCwgdmFsdWUsIGtleSkge1xuICAgIGlmIChfLmhhcyhyZXN1bHQsIGtleSkpIHJlc3VsdFtrZXldLnB1c2godmFsdWUpOyBlbHNlIHJlc3VsdFtrZXldID0gW3ZhbHVlXTtcbiAgfSk7XG5cbiAgLy8gSW5kZXhlcyB0aGUgb2JqZWN0J3MgdmFsdWVzIGJ5IGEgY3JpdGVyaW9uLCBzaW1pbGFyIHRvIGBncm91cEJ5YCwgYnV0IGZvclxuICAvLyB3aGVuIHlvdSBrbm93IHRoYXQgeW91ciBpbmRleCB2YWx1ZXMgd2lsbCBiZSB1bmlxdWUuXG4gIF8uaW5kZXhCeSA9IGdyb3VwKGZ1bmN0aW9uKHJlc3VsdCwgdmFsdWUsIGtleSkge1xuICAgIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gIH0pO1xuXG4gIC8vIENvdW50cyBpbnN0YW5jZXMgb2YgYW4gb2JqZWN0IHRoYXQgZ3JvdXAgYnkgYSBjZXJ0YWluIGNyaXRlcmlvbi4gUGFzc1xuICAvLyBlaXRoZXIgYSBzdHJpbmcgYXR0cmlidXRlIHRvIGNvdW50IGJ5LCBvciBhIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyB0aGVcbiAgLy8gY3JpdGVyaW9uLlxuICBfLmNvdW50QnkgPSBncm91cChmdW5jdGlvbihyZXN1bHQsIHZhbHVlLCBrZXkpIHtcbiAgICBpZiAoXy5oYXMocmVzdWx0LCBrZXkpKSByZXN1bHRba2V5XSsrOyBlbHNlIHJlc3VsdFtrZXldID0gMTtcbiAgfSk7XG5cbiAgLy8gU2FmZWx5IGNyZWF0ZSBhIHJlYWwsIGxpdmUgYXJyYXkgZnJvbSBhbnl0aGluZyBpdGVyYWJsZS5cbiAgXy50b0FycmF5ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKCFvYmopIHJldHVybiBbXTtcbiAgICBpZiAoXy5pc0FycmF5KG9iaikpIHJldHVybiBzbGljZS5jYWxsKG9iaik7XG4gICAgaWYgKGlzQXJyYXlMaWtlKG9iaikpIHJldHVybiBfLm1hcChvYmosIF8uaWRlbnRpdHkpO1xuICAgIHJldHVybiBfLnZhbHVlcyhvYmopO1xuICB9O1xuXG4gIC8vIFJldHVybiB0aGUgbnVtYmVyIG9mIGVsZW1lbnRzIGluIGFuIG9iamVjdC5cbiAgXy5zaXplID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gMDtcbiAgICByZXR1cm4gaXNBcnJheUxpa2Uob2JqKSA/IG9iai5sZW5ndGggOiBfLmtleXMob2JqKS5sZW5ndGg7XG4gIH07XG5cbiAgLy8gU3BsaXQgYSBjb2xsZWN0aW9uIGludG8gdHdvIGFycmF5czogb25lIHdob3NlIGVsZW1lbnRzIGFsbCBzYXRpc2Z5IHRoZSBnaXZlblxuICAvLyBwcmVkaWNhdGUsIGFuZCBvbmUgd2hvc2UgZWxlbWVudHMgYWxsIGRvIG5vdCBzYXRpc2Z5IHRoZSBwcmVkaWNhdGUuXG4gIF8ucGFydGl0aW9uID0gZnVuY3Rpb24ob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpIHtcbiAgICBwcmVkaWNhdGUgPSBjYihwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIHZhciBwYXNzID0gW10sIGZhaWwgPSBbXTtcbiAgICBfLmVhY2gob2JqLCBmdW5jdGlvbih2YWx1ZSwga2V5LCBvYmopIHtcbiAgICAgIChwcmVkaWNhdGUodmFsdWUsIGtleSwgb2JqKSA/IHBhc3MgOiBmYWlsKS5wdXNoKHZhbHVlKTtcbiAgICB9KTtcbiAgICByZXR1cm4gW3Bhc3MsIGZhaWxdO1xuICB9O1xuXG4gIC8vIEFycmF5IEZ1bmN0aW9uc1xuICAvLyAtLS0tLS0tLS0tLS0tLS1cblxuICAvLyBHZXQgdGhlIGZpcnN0IGVsZW1lbnQgb2YgYW4gYXJyYXkuIFBhc3NpbmcgKipuKiogd2lsbCByZXR1cm4gdGhlIGZpcnN0IE5cbiAgLy8gdmFsdWVzIGluIHRoZSBhcnJheS4gQWxpYXNlZCBhcyBgaGVhZGAgYW5kIGB0YWtlYC4gVGhlICoqZ3VhcmQqKiBjaGVja1xuICAvLyBhbGxvd3MgaXQgdG8gd29yayB3aXRoIGBfLm1hcGAuXG4gIF8uZmlyc3QgPSBfLmhlYWQgPSBfLnRha2UgPSBmdW5jdGlvbihhcnJheSwgbiwgZ3VhcmQpIHtcbiAgICBpZiAoYXJyYXkgPT0gbnVsbCkgcmV0dXJuIHZvaWQgMDtcbiAgICBpZiAobiA9PSBudWxsIHx8IGd1YXJkKSByZXR1cm4gYXJyYXlbMF07XG4gICAgcmV0dXJuIF8uaW5pdGlhbChhcnJheSwgYXJyYXkubGVuZ3RoIC0gbik7XG4gIH07XG5cbiAgLy8gUmV0dXJucyBldmVyeXRoaW5nIGJ1dCB0aGUgbGFzdCBlbnRyeSBvZiB0aGUgYXJyYXkuIEVzcGVjaWFsbHkgdXNlZnVsIG9uXG4gIC8vIHRoZSBhcmd1bWVudHMgb2JqZWN0LiBQYXNzaW5nICoqbioqIHdpbGwgcmV0dXJuIGFsbCB0aGUgdmFsdWVzIGluXG4gIC8vIHRoZSBhcnJheSwgZXhjbHVkaW5nIHRoZSBsYXN0IE4uXG4gIF8uaW5pdGlhbCA9IGZ1bmN0aW9uKGFycmF5LCBuLCBndWFyZCkge1xuICAgIHJldHVybiBzbGljZS5jYWxsKGFycmF5LCAwLCBNYXRoLm1heCgwLCBhcnJheS5sZW5ndGggLSAobiA9PSBudWxsIHx8IGd1YXJkID8gMSA6IG4pKSk7XG4gIH07XG5cbiAgLy8gR2V0IHRoZSBsYXN0IGVsZW1lbnQgb2YgYW4gYXJyYXkuIFBhc3NpbmcgKipuKiogd2lsbCByZXR1cm4gdGhlIGxhc3QgTlxuICAvLyB2YWx1ZXMgaW4gdGhlIGFycmF5LlxuICBfLmxhc3QgPSBmdW5jdGlvbihhcnJheSwgbiwgZ3VhcmQpIHtcbiAgICBpZiAoYXJyYXkgPT0gbnVsbCkgcmV0dXJuIHZvaWQgMDtcbiAgICBpZiAobiA9PSBudWxsIHx8IGd1YXJkKSByZXR1cm4gYXJyYXlbYXJyYXkubGVuZ3RoIC0gMV07XG4gICAgcmV0dXJuIF8ucmVzdChhcnJheSwgTWF0aC5tYXgoMCwgYXJyYXkubGVuZ3RoIC0gbikpO1xuICB9O1xuXG4gIC8vIFJldHVybnMgZXZlcnl0aGluZyBidXQgdGhlIGZpcnN0IGVudHJ5IG9mIHRoZSBhcnJheS4gQWxpYXNlZCBhcyBgdGFpbGAgYW5kIGBkcm9wYC5cbiAgLy8gRXNwZWNpYWxseSB1c2VmdWwgb24gdGhlIGFyZ3VtZW50cyBvYmplY3QuIFBhc3NpbmcgYW4gKipuKiogd2lsbCByZXR1cm5cbiAgLy8gdGhlIHJlc3QgTiB2YWx1ZXMgaW4gdGhlIGFycmF5LlxuICBfLnJlc3QgPSBfLnRhaWwgPSBfLmRyb3AgPSBmdW5jdGlvbihhcnJheSwgbiwgZ3VhcmQpIHtcbiAgICByZXR1cm4gc2xpY2UuY2FsbChhcnJheSwgbiA9PSBudWxsIHx8IGd1YXJkID8gMSA6IG4pO1xuICB9O1xuXG4gIC8vIFRyaW0gb3V0IGFsbCBmYWxzeSB2YWx1ZXMgZnJvbSBhbiBhcnJheS5cbiAgXy5jb21wYWN0ID0gZnVuY3Rpb24oYXJyYXkpIHtcbiAgICByZXR1cm4gXy5maWx0ZXIoYXJyYXksIF8uaWRlbnRpdHkpO1xuICB9O1xuXG4gIC8vIEludGVybmFsIGltcGxlbWVudGF0aW9uIG9mIGEgcmVjdXJzaXZlIGBmbGF0dGVuYCBmdW5jdGlvbi5cbiAgdmFyIGZsYXR0ZW4gPSBmdW5jdGlvbihpbnB1dCwgc2hhbGxvdywgc3RyaWN0LCBzdGFydEluZGV4KSB7XG4gICAgdmFyIG91dHB1dCA9IFtdLCBpZHggPSAwO1xuICAgIGZvciAodmFyIGkgPSBzdGFydEluZGV4IHx8IDAsIGxlbmd0aCA9IGdldExlbmd0aChpbnB1dCk7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHZhbHVlID0gaW5wdXRbaV07XG4gICAgICBpZiAoaXNBcnJheUxpa2UodmFsdWUpICYmIChfLmlzQXJyYXkodmFsdWUpIHx8IF8uaXNBcmd1bWVudHModmFsdWUpKSkge1xuICAgICAgICAvL2ZsYXR0ZW4gY3VycmVudCBsZXZlbCBvZiBhcnJheSBvciBhcmd1bWVudHMgb2JqZWN0XG4gICAgICAgIGlmICghc2hhbGxvdykgdmFsdWUgPSBmbGF0dGVuKHZhbHVlLCBzaGFsbG93LCBzdHJpY3QpO1xuICAgICAgICB2YXIgaiA9IDAsIGxlbiA9IHZhbHVlLmxlbmd0aDtcbiAgICAgICAgb3V0cHV0Lmxlbmd0aCArPSBsZW47XG4gICAgICAgIHdoaWxlIChqIDwgbGVuKSB7XG4gICAgICAgICAgb3V0cHV0W2lkeCsrXSA9IHZhbHVlW2orK107XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIXN0cmljdCkge1xuICAgICAgICBvdXRwdXRbaWR4KytdID0gdmFsdWU7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvdXRwdXQ7XG4gIH07XG5cbiAgLy8gRmxhdHRlbiBvdXQgYW4gYXJyYXksIGVpdGhlciByZWN1cnNpdmVseSAoYnkgZGVmYXVsdCksIG9yIGp1c3Qgb25lIGxldmVsLlxuICBfLmZsYXR0ZW4gPSBmdW5jdGlvbihhcnJheSwgc2hhbGxvdykge1xuICAgIHJldHVybiBmbGF0dGVuKGFycmF5LCBzaGFsbG93LCBmYWxzZSk7XG4gIH07XG5cbiAgLy8gUmV0dXJuIGEgdmVyc2lvbiBvZiB0aGUgYXJyYXkgdGhhdCBkb2VzIG5vdCBjb250YWluIHRoZSBzcGVjaWZpZWQgdmFsdWUocykuXG4gIF8ud2l0aG91dCA9IGZ1bmN0aW9uKGFycmF5KSB7XG4gICAgcmV0dXJuIF8uZGlmZmVyZW5jZShhcnJheSwgc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpKTtcbiAgfTtcblxuICAvLyBQcm9kdWNlIGEgZHVwbGljYXRlLWZyZWUgdmVyc2lvbiBvZiB0aGUgYXJyYXkuIElmIHRoZSBhcnJheSBoYXMgYWxyZWFkeVxuICAvLyBiZWVuIHNvcnRlZCwgeW91IGhhdmUgdGhlIG9wdGlvbiBvZiB1c2luZyBhIGZhc3RlciBhbGdvcml0aG0uXG4gIC8vIEFsaWFzZWQgYXMgYHVuaXF1ZWAuXG4gIF8udW5pcSA9IF8udW5pcXVlID0gZnVuY3Rpb24oYXJyYXksIGlzU29ydGVkLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIGlmICghXy5pc0Jvb2xlYW4oaXNTb3J0ZWQpKSB7XG4gICAgICBjb250ZXh0ID0gaXRlcmF0ZWU7XG4gICAgICBpdGVyYXRlZSA9IGlzU29ydGVkO1xuICAgICAgaXNTb3J0ZWQgPSBmYWxzZTtcbiAgICB9XG4gICAgaWYgKGl0ZXJhdGVlICE9IG51bGwpIGl0ZXJhdGVlID0gY2IoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICB2YXIgc2VlbiA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBnZXRMZW5ndGgoYXJyYXkpOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciB2YWx1ZSA9IGFycmF5W2ldLFxuICAgICAgICAgIGNvbXB1dGVkID0gaXRlcmF0ZWUgPyBpdGVyYXRlZSh2YWx1ZSwgaSwgYXJyYXkpIDogdmFsdWU7XG4gICAgICBpZiAoaXNTb3J0ZWQpIHtcbiAgICAgICAgaWYgKCFpIHx8IHNlZW4gIT09IGNvbXB1dGVkKSByZXN1bHQucHVzaCh2YWx1ZSk7XG4gICAgICAgIHNlZW4gPSBjb21wdXRlZDtcbiAgICAgIH0gZWxzZSBpZiAoaXRlcmF0ZWUpIHtcbiAgICAgICAgaWYgKCFfLmNvbnRhaW5zKHNlZW4sIGNvbXB1dGVkKSkge1xuICAgICAgICAgIHNlZW4ucHVzaChjb21wdXRlZCk7XG4gICAgICAgICAgcmVzdWx0LnB1c2godmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKCFfLmNvbnRhaW5zKHJlc3VsdCwgdmFsdWUpKSB7XG4gICAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBQcm9kdWNlIGFuIGFycmF5IHRoYXQgY29udGFpbnMgdGhlIHVuaW9uOiBlYWNoIGRpc3RpbmN0IGVsZW1lbnQgZnJvbSBhbGwgb2ZcbiAgLy8gdGhlIHBhc3NlZC1pbiBhcnJheXMuXG4gIF8udW5pb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXy51bmlxKGZsYXR0ZW4oYXJndW1lbnRzLCB0cnVlLCB0cnVlKSk7XG4gIH07XG5cbiAgLy8gUHJvZHVjZSBhbiBhcnJheSB0aGF0IGNvbnRhaW5zIGV2ZXJ5IGl0ZW0gc2hhcmVkIGJldHdlZW4gYWxsIHRoZVxuICAvLyBwYXNzZWQtaW4gYXJyYXlzLlxuICBfLmludGVyc2VjdGlvbiA9IGZ1bmN0aW9uKGFycmF5KSB7XG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgIHZhciBhcmdzTGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0gZ2V0TGVuZ3RoKGFycmF5KTsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgaXRlbSA9IGFycmF5W2ldO1xuICAgICAgaWYgKF8uY29udGFpbnMocmVzdWx0LCBpdGVtKSkgY29udGludWU7XG4gICAgICBmb3IgKHZhciBqID0gMTsgaiA8IGFyZ3NMZW5ndGg7IGorKykge1xuICAgICAgICBpZiAoIV8uY29udGFpbnMoYXJndW1lbnRzW2pdLCBpdGVtKSkgYnJlYWs7XG4gICAgICB9XG4gICAgICBpZiAoaiA9PT0gYXJnc0xlbmd0aCkgcmVzdWx0LnB1c2goaXRlbSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gVGFrZSB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIG9uZSBhcnJheSBhbmQgYSBudW1iZXIgb2Ygb3RoZXIgYXJyYXlzLlxuICAvLyBPbmx5IHRoZSBlbGVtZW50cyBwcmVzZW50IGluIGp1c3QgdGhlIGZpcnN0IGFycmF5IHdpbGwgcmVtYWluLlxuICBfLmRpZmZlcmVuY2UgPSBmdW5jdGlvbihhcnJheSkge1xuICAgIHZhciByZXN0ID0gZmxhdHRlbihhcmd1bWVudHMsIHRydWUsIHRydWUsIDEpO1xuICAgIHJldHVybiBfLmZpbHRlcihhcnJheSwgZnVuY3Rpb24odmFsdWUpe1xuICAgICAgcmV0dXJuICFfLmNvbnRhaW5zKHJlc3QsIHZhbHVlKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBaaXAgdG9nZXRoZXIgbXVsdGlwbGUgbGlzdHMgaW50byBhIHNpbmdsZSBhcnJheSAtLSBlbGVtZW50cyB0aGF0IHNoYXJlXG4gIC8vIGFuIGluZGV4IGdvIHRvZ2V0aGVyLlxuICBfLnppcCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBfLnVuemlwKGFyZ3VtZW50cyk7XG4gIH07XG5cbiAgLy8gQ29tcGxlbWVudCBvZiBfLnppcC4gVW56aXAgYWNjZXB0cyBhbiBhcnJheSBvZiBhcnJheXMgYW5kIGdyb3Vwc1xuICAvLyBlYWNoIGFycmF5J3MgZWxlbWVudHMgb24gc2hhcmVkIGluZGljZXNcbiAgXy51bnppcCA9IGZ1bmN0aW9uKGFycmF5KSB7XG4gICAgdmFyIGxlbmd0aCA9IGFycmF5ICYmIF8ubWF4KGFycmF5LCBnZXRMZW5ndGgpLmxlbmd0aCB8fCAwO1xuICAgIHZhciByZXN1bHQgPSBBcnJheShsZW5ndGgpO1xuXG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgcmVzdWx0W2luZGV4XSA9IF8ucGx1Y2soYXJyYXksIGluZGV4KTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBDb252ZXJ0cyBsaXN0cyBpbnRvIG9iamVjdHMuIFBhc3MgZWl0aGVyIGEgc2luZ2xlIGFycmF5IG9mIGBba2V5LCB2YWx1ZV1gXG4gIC8vIHBhaXJzLCBvciB0d28gcGFyYWxsZWwgYXJyYXlzIG9mIHRoZSBzYW1lIGxlbmd0aCAtLSBvbmUgb2Yga2V5cywgYW5kIG9uZSBvZlxuICAvLyB0aGUgY29ycmVzcG9uZGluZyB2YWx1ZXMuXG4gIF8ub2JqZWN0ID0gZnVuY3Rpb24obGlzdCwgdmFsdWVzKSB7XG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBnZXRMZW5ndGgobGlzdCk7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHZhbHVlcykge1xuICAgICAgICByZXN1bHRbbGlzdFtpXV0gPSB2YWx1ZXNbaV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHRbbGlzdFtpXVswXV0gPSBsaXN0W2ldWzFdO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIEdlbmVyYXRvciBmdW5jdGlvbiB0byBjcmVhdGUgdGhlIGZpbmRJbmRleCBhbmQgZmluZExhc3RJbmRleCBmdW5jdGlvbnNcbiAgZnVuY3Rpb24gY3JlYXRlUHJlZGljYXRlSW5kZXhGaW5kZXIoZGlyKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGFycmF5LCBwcmVkaWNhdGUsIGNvbnRleHQpIHtcbiAgICAgIHByZWRpY2F0ZSA9IGNiKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgICB2YXIgbGVuZ3RoID0gZ2V0TGVuZ3RoKGFycmF5KTtcbiAgICAgIHZhciBpbmRleCA9IGRpciA+IDAgPyAwIDogbGVuZ3RoIC0gMTtcbiAgICAgIGZvciAoOyBpbmRleCA+PSAwICYmIGluZGV4IDwgbGVuZ3RoOyBpbmRleCArPSBkaXIpIHtcbiAgICAgICAgaWYgKHByZWRpY2F0ZShhcnJheVtpbmRleF0sIGluZGV4LCBhcnJheSkpIHJldHVybiBpbmRleDtcbiAgICAgIH1cbiAgICAgIHJldHVybiAtMTtcbiAgICB9O1xuICB9XG5cbiAgLy8gUmV0dXJucyB0aGUgZmlyc3QgaW5kZXggb24gYW4gYXJyYXktbGlrZSB0aGF0IHBhc3NlcyBhIHByZWRpY2F0ZSB0ZXN0XG4gIF8uZmluZEluZGV4ID0gY3JlYXRlUHJlZGljYXRlSW5kZXhGaW5kZXIoMSk7XG4gIF8uZmluZExhc3RJbmRleCA9IGNyZWF0ZVByZWRpY2F0ZUluZGV4RmluZGVyKC0xKTtcblxuICAvLyBVc2UgYSBjb21wYXJhdG9yIGZ1bmN0aW9uIHRvIGZpZ3VyZSBvdXQgdGhlIHNtYWxsZXN0IGluZGV4IGF0IHdoaWNoXG4gIC8vIGFuIG9iamVjdCBzaG91bGQgYmUgaW5zZXJ0ZWQgc28gYXMgdG8gbWFpbnRhaW4gb3JkZXIuIFVzZXMgYmluYXJ5IHNlYXJjaC5cbiAgXy5zb3J0ZWRJbmRleCA9IGZ1bmN0aW9uKGFycmF5LCBvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaXRlcmF0ZWUgPSBjYihpdGVyYXRlZSwgY29udGV4dCwgMSk7XG4gICAgdmFyIHZhbHVlID0gaXRlcmF0ZWUob2JqKTtcbiAgICB2YXIgbG93ID0gMCwgaGlnaCA9IGdldExlbmd0aChhcnJheSk7XG4gICAgd2hpbGUgKGxvdyA8IGhpZ2gpIHtcbiAgICAgIHZhciBtaWQgPSBNYXRoLmZsb29yKChsb3cgKyBoaWdoKSAvIDIpO1xuICAgICAgaWYgKGl0ZXJhdGVlKGFycmF5W21pZF0pIDwgdmFsdWUpIGxvdyA9IG1pZCArIDE7IGVsc2UgaGlnaCA9IG1pZDtcbiAgICB9XG4gICAgcmV0dXJuIGxvdztcbiAgfTtcblxuICAvLyBHZW5lcmF0b3IgZnVuY3Rpb24gdG8gY3JlYXRlIHRoZSBpbmRleE9mIGFuZCBsYXN0SW5kZXhPZiBmdW5jdGlvbnNcbiAgZnVuY3Rpb24gY3JlYXRlSW5kZXhGaW5kZXIoZGlyLCBwcmVkaWNhdGVGaW5kLCBzb3J0ZWRJbmRleCkge1xuICAgIHJldHVybiBmdW5jdGlvbihhcnJheSwgaXRlbSwgaWR4KSB7XG4gICAgICB2YXIgaSA9IDAsIGxlbmd0aCA9IGdldExlbmd0aChhcnJheSk7XG4gICAgICBpZiAodHlwZW9mIGlkeCA9PSAnbnVtYmVyJykge1xuICAgICAgICBpZiAoZGlyID4gMCkge1xuICAgICAgICAgICAgaSA9IGlkeCA+PSAwID8gaWR4IDogTWF0aC5tYXgoaWR4ICsgbGVuZ3RoLCBpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxlbmd0aCA9IGlkeCA+PSAwID8gTWF0aC5taW4oaWR4ICsgMSwgbGVuZ3RoKSA6IGlkeCArIGxlbmd0aCArIDE7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoc29ydGVkSW5kZXggJiYgaWR4ICYmIGxlbmd0aCkge1xuICAgICAgICBpZHggPSBzb3J0ZWRJbmRleChhcnJheSwgaXRlbSk7XG4gICAgICAgIHJldHVybiBhcnJheVtpZHhdID09PSBpdGVtID8gaWR4IDogLTE7XG4gICAgICB9XG4gICAgICBpZiAoaXRlbSAhPT0gaXRlbSkge1xuICAgICAgICBpZHggPSBwcmVkaWNhdGVGaW5kKHNsaWNlLmNhbGwoYXJyYXksIGksIGxlbmd0aCksIF8uaXNOYU4pO1xuICAgICAgICByZXR1cm4gaWR4ID49IDAgPyBpZHggKyBpIDogLTE7XG4gICAgICB9XG4gICAgICBmb3IgKGlkeCA9IGRpciA+IDAgPyBpIDogbGVuZ3RoIC0gMTsgaWR4ID49IDAgJiYgaWR4IDwgbGVuZ3RoOyBpZHggKz0gZGlyKSB7XG4gICAgICAgIGlmIChhcnJheVtpZHhdID09PSBpdGVtKSByZXR1cm4gaWR4O1xuICAgICAgfVxuICAgICAgcmV0dXJuIC0xO1xuICAgIH07XG4gIH1cblxuICAvLyBSZXR1cm4gdGhlIHBvc2l0aW9uIG9mIHRoZSBmaXJzdCBvY2N1cnJlbmNlIG9mIGFuIGl0ZW0gaW4gYW4gYXJyYXksXG4gIC8vIG9yIC0xIGlmIHRoZSBpdGVtIGlzIG5vdCBpbmNsdWRlZCBpbiB0aGUgYXJyYXkuXG4gIC8vIElmIHRoZSBhcnJheSBpcyBsYXJnZSBhbmQgYWxyZWFkeSBpbiBzb3J0IG9yZGVyLCBwYXNzIGB0cnVlYFxuICAvLyBmb3IgKippc1NvcnRlZCoqIHRvIHVzZSBiaW5hcnkgc2VhcmNoLlxuICBfLmluZGV4T2YgPSBjcmVhdGVJbmRleEZpbmRlcigxLCBfLmZpbmRJbmRleCwgXy5zb3J0ZWRJbmRleCk7XG4gIF8ubGFzdEluZGV4T2YgPSBjcmVhdGVJbmRleEZpbmRlcigtMSwgXy5maW5kTGFzdEluZGV4KTtcblxuICAvLyBHZW5lcmF0ZSBhbiBpbnRlZ2VyIEFycmF5IGNvbnRhaW5pbmcgYW4gYXJpdGhtZXRpYyBwcm9ncmVzc2lvbi4gQSBwb3J0IG9mXG4gIC8vIHRoZSBuYXRpdmUgUHl0aG9uIGByYW5nZSgpYCBmdW5jdGlvbi4gU2VlXG4gIC8vIFt0aGUgUHl0aG9uIGRvY3VtZW50YXRpb25dKGh0dHA6Ly9kb2NzLnB5dGhvbi5vcmcvbGlicmFyeS9mdW5jdGlvbnMuaHRtbCNyYW5nZSkuXG4gIF8ucmFuZ2UgPSBmdW5jdGlvbihzdGFydCwgc3RvcCwgc3RlcCkge1xuICAgIGlmIChzdG9wID09IG51bGwpIHtcbiAgICAgIHN0b3AgPSBzdGFydCB8fCAwO1xuICAgICAgc3RhcnQgPSAwO1xuICAgIH1cbiAgICBzdGVwID0gc3RlcCB8fCAxO1xuXG4gICAgdmFyIGxlbmd0aCA9IE1hdGgubWF4KE1hdGguY2VpbCgoc3RvcCAtIHN0YXJ0KSAvIHN0ZXApLCAwKTtcbiAgICB2YXIgcmFuZ2UgPSBBcnJheShsZW5ndGgpO1xuXG4gICAgZm9yICh2YXIgaWR4ID0gMDsgaWR4IDwgbGVuZ3RoOyBpZHgrKywgc3RhcnQgKz0gc3RlcCkge1xuICAgICAgcmFuZ2VbaWR4XSA9IHN0YXJ0O1xuICAgIH1cblxuICAgIHJldHVybiByYW5nZTtcbiAgfTtcblxuICAvLyBGdW5jdGlvbiAoYWhlbSkgRnVuY3Rpb25zXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8vIERldGVybWluZXMgd2hldGhlciB0byBleGVjdXRlIGEgZnVuY3Rpb24gYXMgYSBjb25zdHJ1Y3RvclxuICAvLyBvciBhIG5vcm1hbCBmdW5jdGlvbiB3aXRoIHRoZSBwcm92aWRlZCBhcmd1bWVudHNcbiAgdmFyIGV4ZWN1dGVCb3VuZCA9IGZ1bmN0aW9uKHNvdXJjZUZ1bmMsIGJvdW5kRnVuYywgY29udGV4dCwgY2FsbGluZ0NvbnRleHQsIGFyZ3MpIHtcbiAgICBpZiAoIShjYWxsaW5nQ29udGV4dCBpbnN0YW5jZW9mIGJvdW5kRnVuYykpIHJldHVybiBzb3VyY2VGdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgIHZhciBzZWxmID0gYmFzZUNyZWF0ZShzb3VyY2VGdW5jLnByb3RvdHlwZSk7XG4gICAgdmFyIHJlc3VsdCA9IHNvdXJjZUZ1bmMuYXBwbHkoc2VsZiwgYXJncyk7XG4gICAgaWYgKF8uaXNPYmplY3QocmVzdWx0KSkgcmV0dXJuIHJlc3VsdDtcbiAgICByZXR1cm4gc2VsZjtcbiAgfTtcblxuICAvLyBDcmVhdGUgYSBmdW5jdGlvbiBib3VuZCB0byBhIGdpdmVuIG9iamVjdCAoYXNzaWduaW5nIGB0aGlzYCwgYW5kIGFyZ3VtZW50cyxcbiAgLy8gb3B0aW9uYWxseSkuIERlbGVnYXRlcyB0byAqKkVDTUFTY3JpcHQgNSoqJ3MgbmF0aXZlIGBGdW5jdGlvbi5iaW5kYCBpZlxuICAvLyBhdmFpbGFibGUuXG4gIF8uYmluZCA9IGZ1bmN0aW9uKGZ1bmMsIGNvbnRleHQpIHtcbiAgICBpZiAobmF0aXZlQmluZCAmJiBmdW5jLmJpbmQgPT09IG5hdGl2ZUJpbmQpIHJldHVybiBuYXRpdmVCaW5kLmFwcGx5KGZ1bmMsIHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKSk7XG4gICAgaWYgKCFfLmlzRnVuY3Rpb24oZnVuYykpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0JpbmQgbXVzdCBiZSBjYWxsZWQgb24gYSBmdW5jdGlvbicpO1xuICAgIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpO1xuICAgIHZhciBib3VuZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGV4ZWN1dGVCb3VuZChmdW5jLCBib3VuZCwgY29udGV4dCwgdGhpcywgYXJncy5jb25jYXQoc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gICAgfTtcbiAgICByZXR1cm4gYm91bmQ7XG4gIH07XG5cbiAgLy8gUGFydGlhbGx5IGFwcGx5IGEgZnVuY3Rpb24gYnkgY3JlYXRpbmcgYSB2ZXJzaW9uIHRoYXQgaGFzIGhhZCBzb21lIG9mIGl0c1xuICAvLyBhcmd1bWVudHMgcHJlLWZpbGxlZCwgd2l0aG91dCBjaGFuZ2luZyBpdHMgZHluYW1pYyBgdGhpc2AgY29udGV4dC4gXyBhY3RzXG4gIC8vIGFzIGEgcGxhY2Vob2xkZXIsIGFsbG93aW5nIGFueSBjb21iaW5hdGlvbiBvZiBhcmd1bWVudHMgdG8gYmUgcHJlLWZpbGxlZC5cbiAgXy5wYXJ0aWFsID0gZnVuY3Rpb24oZnVuYykge1xuICAgIHZhciBib3VuZEFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgdmFyIGJvdW5kID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcG9zaXRpb24gPSAwLCBsZW5ndGggPSBib3VuZEFyZ3MubGVuZ3RoO1xuICAgICAgdmFyIGFyZ3MgPSBBcnJheShsZW5ndGgpO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICBhcmdzW2ldID0gYm91bmRBcmdzW2ldID09PSBfID8gYXJndW1lbnRzW3Bvc2l0aW9uKytdIDogYm91bmRBcmdzW2ldO1xuICAgICAgfVxuICAgICAgd2hpbGUgKHBvc2l0aW9uIDwgYXJndW1lbnRzLmxlbmd0aCkgYXJncy5wdXNoKGFyZ3VtZW50c1twb3NpdGlvbisrXSk7XG4gICAgICByZXR1cm4gZXhlY3V0ZUJvdW5kKGZ1bmMsIGJvdW5kLCB0aGlzLCB0aGlzLCBhcmdzKTtcbiAgICB9O1xuICAgIHJldHVybiBib3VuZDtcbiAgfTtcblxuICAvLyBCaW5kIGEgbnVtYmVyIG9mIGFuIG9iamVjdCdzIG1ldGhvZHMgdG8gdGhhdCBvYmplY3QuIFJlbWFpbmluZyBhcmd1bWVudHNcbiAgLy8gYXJlIHRoZSBtZXRob2QgbmFtZXMgdG8gYmUgYm91bmQuIFVzZWZ1bCBmb3IgZW5zdXJpbmcgdGhhdCBhbGwgY2FsbGJhY2tzXG4gIC8vIGRlZmluZWQgb24gYW4gb2JqZWN0IGJlbG9uZyB0byBpdC5cbiAgXy5iaW5kQWxsID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIGksIGxlbmd0aCA9IGFyZ3VtZW50cy5sZW5ndGgsIGtleTtcbiAgICBpZiAobGVuZ3RoIDw9IDEpIHRocm93IG5ldyBFcnJvcignYmluZEFsbCBtdXN0IGJlIHBhc3NlZCBmdW5jdGlvbiBuYW1lcycpO1xuICAgIGZvciAoaSA9IDE7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAga2V5ID0gYXJndW1lbnRzW2ldO1xuICAgICAgb2JqW2tleV0gPSBfLmJpbmQob2JqW2tleV0sIG9iaik7XG4gICAgfVxuICAgIHJldHVybiBvYmo7XG4gIH07XG5cbiAgLy8gTWVtb2l6ZSBhbiBleHBlbnNpdmUgZnVuY3Rpb24gYnkgc3RvcmluZyBpdHMgcmVzdWx0cy5cbiAgXy5tZW1vaXplID0gZnVuY3Rpb24oZnVuYywgaGFzaGVyKSB7XG4gICAgdmFyIG1lbW9pemUgPSBmdW5jdGlvbihrZXkpIHtcbiAgICAgIHZhciBjYWNoZSA9IG1lbW9pemUuY2FjaGU7XG4gICAgICB2YXIgYWRkcmVzcyA9ICcnICsgKGhhc2hlciA/IGhhc2hlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDoga2V5KTtcbiAgICAgIGlmICghXy5oYXMoY2FjaGUsIGFkZHJlc3MpKSBjYWNoZVthZGRyZXNzXSA9IGZ1bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIHJldHVybiBjYWNoZVthZGRyZXNzXTtcbiAgICB9O1xuICAgIG1lbW9pemUuY2FjaGUgPSB7fTtcbiAgICByZXR1cm4gbWVtb2l6ZTtcbiAgfTtcblxuICAvLyBEZWxheXMgYSBmdW5jdGlvbiBmb3IgdGhlIGdpdmVuIG51bWJlciBvZiBtaWxsaXNlY29uZHMsIGFuZCB0aGVuIGNhbGxzXG4gIC8vIGl0IHdpdGggdGhlIGFyZ3VtZW50cyBzdXBwbGllZC5cbiAgXy5kZWxheSA9IGZ1bmN0aW9uKGZ1bmMsIHdhaXQpIHtcbiAgICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgICByZXR1cm4gc2V0VGltZW91dChmdW5jdGlvbigpe1xuICAgICAgcmV0dXJuIGZ1bmMuYXBwbHkobnVsbCwgYXJncyk7XG4gICAgfSwgd2FpdCk7XG4gIH07XG5cbiAgLy8gRGVmZXJzIGEgZnVuY3Rpb24sIHNjaGVkdWxpbmcgaXQgdG8gcnVuIGFmdGVyIHRoZSBjdXJyZW50IGNhbGwgc3RhY2sgaGFzXG4gIC8vIGNsZWFyZWQuXG4gIF8uZGVmZXIgPSBfLnBhcnRpYWwoXy5kZWxheSwgXywgMSk7XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uLCB0aGF0LCB3aGVuIGludm9rZWQsIHdpbGwgb25seSBiZSB0cmlnZ2VyZWQgYXQgbW9zdCBvbmNlXG4gIC8vIGR1cmluZyBhIGdpdmVuIHdpbmRvdyBvZiB0aW1lLiBOb3JtYWxseSwgdGhlIHRocm90dGxlZCBmdW5jdGlvbiB3aWxsIHJ1blxuICAvLyBhcyBtdWNoIGFzIGl0IGNhbiwgd2l0aG91dCBldmVyIGdvaW5nIG1vcmUgdGhhbiBvbmNlIHBlciBgd2FpdGAgZHVyYXRpb247XG4gIC8vIGJ1dCBpZiB5b3UnZCBsaWtlIHRvIGRpc2FibGUgdGhlIGV4ZWN1dGlvbiBvbiB0aGUgbGVhZGluZyBlZGdlLCBwYXNzXG4gIC8vIGB7bGVhZGluZzogZmFsc2V9YC4gVG8gZGlzYWJsZSBleGVjdXRpb24gb24gdGhlIHRyYWlsaW5nIGVkZ2UsIGRpdHRvLlxuICBfLnRocm90dGxlID0gZnVuY3Rpb24oZnVuYywgd2FpdCwgb3B0aW9ucykge1xuICAgIHZhciBjb250ZXh0LCBhcmdzLCByZXN1bHQ7XG4gICAgdmFyIHRpbWVvdXQgPSBudWxsO1xuICAgIHZhciBwcmV2aW91cyA9IDA7XG4gICAgaWYgKCFvcHRpb25zKSBvcHRpb25zID0ge307XG4gICAgdmFyIGxhdGVyID0gZnVuY3Rpb24oKSB7XG4gICAgICBwcmV2aW91cyA9IG9wdGlvbnMubGVhZGluZyA9PT0gZmFsc2UgPyAwIDogXy5ub3coKTtcbiAgICAgIHRpbWVvdXQgPSBudWxsO1xuICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgIH07XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG5vdyA9IF8ubm93KCk7XG4gICAgICBpZiAoIXByZXZpb3VzICYmIG9wdGlvbnMubGVhZGluZyA9PT0gZmFsc2UpIHByZXZpb3VzID0gbm93O1xuICAgICAgdmFyIHJlbWFpbmluZyA9IHdhaXQgLSAobm93IC0gcHJldmlvdXMpO1xuICAgICAgY29udGV4dCA9IHRoaXM7XG4gICAgICBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgaWYgKHJlbWFpbmluZyA8PSAwIHx8IHJlbWFpbmluZyA+IHdhaXQpIHtcbiAgICAgICAgaWYgKHRpbWVvdXQpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgcHJldmlvdXMgPSBub3c7XG4gICAgICAgIHJlc3VsdCA9IGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgfSBlbHNlIGlmICghdGltZW91dCAmJiBvcHRpb25zLnRyYWlsaW5nICE9PSBmYWxzZSkge1xuICAgICAgICB0aW1lb3V0ID0gc2V0VGltZW91dChsYXRlciwgcmVtYWluaW5nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24sIHRoYXQsIGFzIGxvbmcgYXMgaXQgY29udGludWVzIHRvIGJlIGludm9rZWQsIHdpbGwgbm90XG4gIC8vIGJlIHRyaWdnZXJlZC4gVGhlIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGl0IHN0b3BzIGJlaW5nIGNhbGxlZCBmb3JcbiAgLy8gTiBtaWxsaXNlY29uZHMuIElmIGBpbW1lZGlhdGVgIGlzIHBhc3NlZCwgdHJpZ2dlciB0aGUgZnVuY3Rpb24gb24gdGhlXG4gIC8vIGxlYWRpbmcgZWRnZSwgaW5zdGVhZCBvZiB0aGUgdHJhaWxpbmcuXG4gIF8uZGVib3VuY2UgPSBmdW5jdGlvbihmdW5jLCB3YWl0LCBpbW1lZGlhdGUpIHtcbiAgICB2YXIgdGltZW91dCwgYXJncywgY29udGV4dCwgdGltZXN0YW1wLCByZXN1bHQ7XG5cbiAgICB2YXIgbGF0ZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBsYXN0ID0gXy5ub3coKSAtIHRpbWVzdGFtcDtcblxuICAgICAgaWYgKGxhc3QgPCB3YWl0ICYmIGxhc3QgPj0gMCkge1xuICAgICAgICB0aW1lb3V0ID0gc2V0VGltZW91dChsYXRlciwgd2FpdCAtIGxhc3QpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgICAgIGlmICghaW1tZWRpYXRlKSB7XG4gICAgICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgICAgICBpZiAoIXRpbWVvdXQpIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICBjb250ZXh0ID0gdGhpcztcbiAgICAgIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICB0aW1lc3RhbXAgPSBfLm5vdygpO1xuICAgICAgdmFyIGNhbGxOb3cgPSBpbW1lZGlhdGUgJiYgIXRpbWVvdXQ7XG4gICAgICBpZiAoIXRpbWVvdXQpIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGxhdGVyLCB3YWl0KTtcbiAgICAgIGlmIChjYWxsTm93KSB7XG4gICAgICAgIHJlc3VsdCA9IGZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgICAgIGNvbnRleHQgPSBhcmdzID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9O1xuXG4gIC8vIFJldHVybnMgdGhlIGZpcnN0IGZ1bmN0aW9uIHBhc3NlZCBhcyBhbiBhcmd1bWVudCB0byB0aGUgc2Vjb25kLFxuICAvLyBhbGxvd2luZyB5b3UgdG8gYWRqdXN0IGFyZ3VtZW50cywgcnVuIGNvZGUgYmVmb3JlIGFuZCBhZnRlciwgYW5kXG4gIC8vIGNvbmRpdGlvbmFsbHkgZXhlY3V0ZSB0aGUgb3JpZ2luYWwgZnVuY3Rpb24uXG4gIF8ud3JhcCA9IGZ1bmN0aW9uKGZ1bmMsIHdyYXBwZXIpIHtcbiAgICByZXR1cm4gXy5wYXJ0aWFsKHdyYXBwZXIsIGZ1bmMpO1xuICB9O1xuXG4gIC8vIFJldHVybnMgYSBuZWdhdGVkIHZlcnNpb24gb2YgdGhlIHBhc3NlZC1pbiBwcmVkaWNhdGUuXG4gIF8ubmVnYXRlID0gZnVuY3Rpb24ocHJlZGljYXRlKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuICFwcmVkaWNhdGUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9O1xuXG4gIC8vIFJldHVybnMgYSBmdW5jdGlvbiB0aGF0IGlzIHRoZSBjb21wb3NpdGlvbiBvZiBhIGxpc3Qgb2YgZnVuY3Rpb25zLCBlYWNoXG4gIC8vIGNvbnN1bWluZyB0aGUgcmV0dXJuIHZhbHVlIG9mIHRoZSBmdW5jdGlvbiB0aGF0IGZvbGxvd3MuXG4gIF8uY29tcG9zZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgIHZhciBzdGFydCA9IGFyZ3MubGVuZ3RoIC0gMTtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgaSA9IHN0YXJ0O1xuICAgICAgdmFyIHJlc3VsdCA9IGFyZ3Nbc3RhcnRdLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB3aGlsZSAoaS0tKSByZXN1bHQgPSBhcmdzW2ldLmNhbGwodGhpcywgcmVzdWx0KTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCB3aWxsIG9ubHkgYmUgZXhlY3V0ZWQgb24gYW5kIGFmdGVyIHRoZSBOdGggY2FsbC5cbiAgXy5hZnRlciA9IGZ1bmN0aW9uKHRpbWVzLCBmdW5jKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKC0tdGltZXMgPCAxKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCB3aWxsIG9ubHkgYmUgZXhlY3V0ZWQgdXAgdG8gKGJ1dCBub3QgaW5jbHVkaW5nKSB0aGUgTnRoIGNhbGwuXG4gIF8uYmVmb3JlID0gZnVuY3Rpb24odGltZXMsIGZ1bmMpIHtcbiAgICB2YXIgbWVtbztcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoLS10aW1lcyA+IDApIHtcbiAgICAgICAgbWVtbyA9IGZ1bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aW1lcyA8PSAxKSBmdW5jID0gbnVsbDtcbiAgICAgIHJldHVybiBtZW1vO1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgd2lsbCBiZSBleGVjdXRlZCBhdCBtb3N0IG9uZSB0aW1lLCBubyBtYXR0ZXIgaG93XG4gIC8vIG9mdGVuIHlvdSBjYWxsIGl0LiBVc2VmdWwgZm9yIGxhenkgaW5pdGlhbGl6YXRpb24uXG4gIF8ub25jZSA9IF8ucGFydGlhbChfLmJlZm9yZSwgMik7XG5cbiAgLy8gT2JqZWN0IEZ1bmN0aW9uc1xuICAvLyAtLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gS2V5cyBpbiBJRSA8IDkgdGhhdCB3b24ndCBiZSBpdGVyYXRlZCBieSBgZm9yIGtleSBpbiAuLi5gIGFuZCB0aHVzIG1pc3NlZC5cbiAgdmFyIGhhc0VudW1CdWcgPSAhe3RvU3RyaW5nOiBudWxsfS5wcm9wZXJ0eUlzRW51bWVyYWJsZSgndG9TdHJpbmcnKTtcbiAgdmFyIG5vbkVudW1lcmFibGVQcm9wcyA9IFsndmFsdWVPZicsICdpc1Byb3RvdHlwZU9mJywgJ3RvU3RyaW5nJyxcbiAgICAgICAgICAgICAgICAgICAgICAncHJvcGVydHlJc0VudW1lcmFibGUnLCAnaGFzT3duUHJvcGVydHknLCAndG9Mb2NhbGVTdHJpbmcnXTtcblxuICBmdW5jdGlvbiBjb2xsZWN0Tm9uRW51bVByb3BzKG9iaiwga2V5cykge1xuICAgIHZhciBub25FbnVtSWR4ID0gbm9uRW51bWVyYWJsZVByb3BzLmxlbmd0aDtcbiAgICB2YXIgY29uc3RydWN0b3IgPSBvYmouY29uc3RydWN0b3I7XG4gICAgdmFyIHByb3RvID0gKF8uaXNGdW5jdGlvbihjb25zdHJ1Y3RvcikgJiYgY29uc3RydWN0b3IucHJvdG90eXBlKSB8fCBPYmpQcm90bztcblxuICAgIC8vIENvbnN0cnVjdG9yIGlzIGEgc3BlY2lhbCBjYXNlLlxuICAgIHZhciBwcm9wID0gJ2NvbnN0cnVjdG9yJztcbiAgICBpZiAoXy5oYXMob2JqLCBwcm9wKSAmJiAhXy5jb250YWlucyhrZXlzLCBwcm9wKSkga2V5cy5wdXNoKHByb3ApO1xuXG4gICAgd2hpbGUgKG5vbkVudW1JZHgtLSkge1xuICAgICAgcHJvcCA9IG5vbkVudW1lcmFibGVQcm9wc1tub25FbnVtSWR4XTtcbiAgICAgIGlmIChwcm9wIGluIG9iaiAmJiBvYmpbcHJvcF0gIT09IHByb3RvW3Byb3BdICYmICFfLmNvbnRhaW5zKGtleXMsIHByb3ApKSB7XG4gICAgICAgIGtleXMucHVzaChwcm9wKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBSZXRyaWV2ZSB0aGUgbmFtZXMgb2YgYW4gb2JqZWN0J3Mgb3duIHByb3BlcnRpZXMuXG4gIC8vIERlbGVnYXRlcyB0byAqKkVDTUFTY3JpcHQgNSoqJ3MgbmF0aXZlIGBPYmplY3Qua2V5c2BcbiAgXy5rZXlzID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKCFfLmlzT2JqZWN0KG9iaikpIHJldHVybiBbXTtcbiAgICBpZiAobmF0aXZlS2V5cykgcmV0dXJuIG5hdGl2ZUtleXMob2JqKTtcbiAgICB2YXIga2V5cyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBvYmopIGlmIChfLmhhcyhvYmosIGtleSkpIGtleXMucHVzaChrZXkpO1xuICAgIC8vIEFoZW0sIElFIDwgOS5cbiAgICBpZiAoaGFzRW51bUJ1ZykgY29sbGVjdE5vbkVudW1Qcm9wcyhvYmosIGtleXMpO1xuICAgIHJldHVybiBrZXlzO1xuICB9O1xuXG4gIC8vIFJldHJpZXZlIGFsbCB0aGUgcHJvcGVydHkgbmFtZXMgb2YgYW4gb2JqZWN0LlxuICBfLmFsbEtleXMgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAoIV8uaXNPYmplY3Qob2JqKSkgcmV0dXJuIFtdO1xuICAgIHZhciBrZXlzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikga2V5cy5wdXNoKGtleSk7XG4gICAgLy8gQWhlbSwgSUUgPCA5LlxuICAgIGlmIChoYXNFbnVtQnVnKSBjb2xsZWN0Tm9uRW51bVByb3BzKG9iaiwga2V5cyk7XG4gICAgcmV0dXJuIGtleXM7XG4gIH07XG5cbiAgLy8gUmV0cmlldmUgdGhlIHZhbHVlcyBvZiBhbiBvYmplY3QncyBwcm9wZXJ0aWVzLlxuICBfLnZhbHVlcyA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaik7XG4gICAgdmFyIGxlbmd0aCA9IGtleXMubGVuZ3RoO1xuICAgIHZhciB2YWx1ZXMgPSBBcnJheShsZW5ndGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhbHVlc1tpXSA9IG9ialtrZXlzW2ldXTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlcztcbiAgfTtcblxuICAvLyBSZXR1cm5zIHRoZSByZXN1bHRzIG9mIGFwcGx5aW5nIHRoZSBpdGVyYXRlZSB0byBlYWNoIGVsZW1lbnQgb2YgdGhlIG9iamVjdFxuICAvLyBJbiBjb250cmFzdCB0byBfLm1hcCBpdCByZXR1cm5zIGFuIG9iamVjdFxuICBfLm1hcE9iamVjdCA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICBpdGVyYXRlZSA9IGNiKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICB2YXIga2V5cyA9ICBfLmtleXMob2JqKSxcbiAgICAgICAgICBsZW5ndGggPSBrZXlzLmxlbmd0aCxcbiAgICAgICAgICByZXN1bHRzID0ge30sXG4gICAgICAgICAgY3VycmVudEtleTtcbiAgICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgY3VycmVudEtleSA9IGtleXNbaW5kZXhdO1xuICAgICAgICByZXN1bHRzW2N1cnJlbnRLZXldID0gaXRlcmF0ZWUob2JqW2N1cnJlbnRLZXldLCBjdXJyZW50S2V5LCBvYmopO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gIH07XG5cbiAgLy8gQ29udmVydCBhbiBvYmplY3QgaW50byBhIGxpc3Qgb2YgYFtrZXksIHZhbHVlXWAgcGFpcnMuXG4gIF8ucGFpcnMgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIga2V5cyA9IF8ua2V5cyhvYmopO1xuICAgIHZhciBsZW5ndGggPSBrZXlzLmxlbmd0aDtcbiAgICB2YXIgcGFpcnMgPSBBcnJheShsZW5ndGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHBhaXJzW2ldID0gW2tleXNbaV0sIG9ialtrZXlzW2ldXV07XG4gICAgfVxuICAgIHJldHVybiBwYWlycztcbiAgfTtcblxuICAvLyBJbnZlcnQgdGhlIGtleXMgYW5kIHZhbHVlcyBvZiBhbiBvYmplY3QuIFRoZSB2YWx1ZXMgbXVzdCBiZSBzZXJpYWxpemFibGUuXG4gIF8uaW52ZXJ0ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaik7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IGtleXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHJlc3VsdFtvYmpba2V5c1tpXV1dID0ga2V5c1tpXTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBSZXR1cm4gYSBzb3J0ZWQgbGlzdCBvZiB0aGUgZnVuY3Rpb24gbmFtZXMgYXZhaWxhYmxlIG9uIHRoZSBvYmplY3QuXG4gIC8vIEFsaWFzZWQgYXMgYG1ldGhvZHNgXG4gIF8uZnVuY3Rpb25zID0gXy5tZXRob2RzID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIG5hbWVzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgaWYgKF8uaXNGdW5jdGlvbihvYmpba2V5XSkpIG5hbWVzLnB1c2goa2V5KTtcbiAgICB9XG4gICAgcmV0dXJuIG5hbWVzLnNvcnQoKTtcbiAgfTtcblxuICAvLyBFeHRlbmQgYSBnaXZlbiBvYmplY3Qgd2l0aCBhbGwgdGhlIHByb3BlcnRpZXMgaW4gcGFzc2VkLWluIG9iamVjdChzKS5cbiAgXy5leHRlbmQgPSBjcmVhdGVBc3NpZ25lcihfLmFsbEtleXMpO1xuXG4gIC8vIEFzc2lnbnMgYSBnaXZlbiBvYmplY3Qgd2l0aCBhbGwgdGhlIG93biBwcm9wZXJ0aWVzIGluIHRoZSBwYXNzZWQtaW4gb2JqZWN0KHMpXG4gIC8vIChodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9PYmplY3QvYXNzaWduKVxuICBfLmV4dGVuZE93biA9IF8uYXNzaWduID0gY3JlYXRlQXNzaWduZXIoXy5rZXlzKTtcblxuICAvLyBSZXR1cm5zIHRoZSBmaXJzdCBrZXkgb24gYW4gb2JqZWN0IHRoYXQgcGFzc2VzIGEgcHJlZGljYXRlIHRlc3RcbiAgXy5maW5kS2V5ID0gZnVuY3Rpb24ob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpIHtcbiAgICBwcmVkaWNhdGUgPSBjYihwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaiksIGtleTtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0ga2V5cy5sZW5ndGg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAga2V5ID0ga2V5c1tpXTtcbiAgICAgIGlmIChwcmVkaWNhdGUob2JqW2tleV0sIGtleSwgb2JqKSkgcmV0dXJuIGtleTtcbiAgICB9XG4gIH07XG5cbiAgLy8gUmV0dXJuIGEgY29weSBvZiB0aGUgb2JqZWN0IG9ubHkgY29udGFpbmluZyB0aGUgd2hpdGVsaXN0ZWQgcHJvcGVydGllcy5cbiAgXy5waWNrID0gZnVuY3Rpb24ob2JqZWN0LCBvaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICB2YXIgcmVzdWx0ID0ge30sIG9iaiA9IG9iamVjdCwgaXRlcmF0ZWUsIGtleXM7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gcmVzdWx0O1xuICAgIGlmIChfLmlzRnVuY3Rpb24ob2l0ZXJhdGVlKSkge1xuICAgICAga2V5cyA9IF8uYWxsS2V5cyhvYmopO1xuICAgICAgaXRlcmF0ZWUgPSBvcHRpbWl6ZUNiKG9pdGVyYXRlZSwgY29udGV4dCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGtleXMgPSBmbGF0dGVuKGFyZ3VtZW50cywgZmFsc2UsIGZhbHNlLCAxKTtcbiAgICAgIGl0ZXJhdGVlID0gZnVuY3Rpb24odmFsdWUsIGtleSwgb2JqKSB7IHJldHVybiBrZXkgaW4gb2JqOyB9O1xuICAgICAgb2JqID0gT2JqZWN0KG9iaik7XG4gICAgfVxuICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBrZXlzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIga2V5ID0ga2V5c1tpXTtcbiAgICAgIHZhciB2YWx1ZSA9IG9ialtrZXldO1xuICAgICAgaWYgKGl0ZXJhdGVlKHZhbHVlLCBrZXksIG9iaikpIHJlc3VsdFtrZXldID0gdmFsdWU7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgIC8vIFJldHVybiBhIGNvcHkgb2YgdGhlIG9iamVjdCB3aXRob3V0IHRoZSBibGFja2xpc3RlZCBwcm9wZXJ0aWVzLlxuICBfLm9taXQgPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaWYgKF8uaXNGdW5jdGlvbihpdGVyYXRlZSkpIHtcbiAgICAgIGl0ZXJhdGVlID0gXy5uZWdhdGUoaXRlcmF0ZWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIga2V5cyA9IF8ubWFwKGZsYXR0ZW4oYXJndW1lbnRzLCBmYWxzZSwgZmFsc2UsIDEpLCBTdHJpbmcpO1xuICAgICAgaXRlcmF0ZWUgPSBmdW5jdGlvbih2YWx1ZSwga2V5KSB7XG4gICAgICAgIHJldHVybiAhXy5jb250YWlucyhrZXlzLCBrZXkpO1xuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIF8ucGljayhvYmosIGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgfTtcblxuICAvLyBGaWxsIGluIGEgZ2l2ZW4gb2JqZWN0IHdpdGggZGVmYXVsdCBwcm9wZXJ0aWVzLlxuICBfLmRlZmF1bHRzID0gY3JlYXRlQXNzaWduZXIoXy5hbGxLZXlzLCB0cnVlKTtcblxuICAvLyBDcmVhdGVzIGFuIG9iamVjdCB0aGF0IGluaGVyaXRzIGZyb20gdGhlIGdpdmVuIHByb3RvdHlwZSBvYmplY3QuXG4gIC8vIElmIGFkZGl0aW9uYWwgcHJvcGVydGllcyBhcmUgcHJvdmlkZWQgdGhlbiB0aGV5IHdpbGwgYmUgYWRkZWQgdG8gdGhlXG4gIC8vIGNyZWF0ZWQgb2JqZWN0LlxuICBfLmNyZWF0ZSA9IGZ1bmN0aW9uKHByb3RvdHlwZSwgcHJvcHMpIHtcbiAgICB2YXIgcmVzdWx0ID0gYmFzZUNyZWF0ZShwcm90b3R5cGUpO1xuICAgIGlmIChwcm9wcykgXy5leHRlbmRPd24ocmVzdWx0LCBwcm9wcyk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBDcmVhdGUgYSAoc2hhbGxvdy1jbG9uZWQpIGR1cGxpY2F0ZSBvZiBhbiBvYmplY3QuXG4gIF8uY2xvbmUgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAoIV8uaXNPYmplY3Qob2JqKSkgcmV0dXJuIG9iajtcbiAgICByZXR1cm4gXy5pc0FycmF5KG9iaikgPyBvYmouc2xpY2UoKSA6IF8uZXh0ZW5kKHt9LCBvYmopO1xuICB9O1xuXG4gIC8vIEludm9rZXMgaW50ZXJjZXB0b3Igd2l0aCB0aGUgb2JqLCBhbmQgdGhlbiByZXR1cm5zIG9iai5cbiAgLy8gVGhlIHByaW1hcnkgcHVycG9zZSBvZiB0aGlzIG1ldGhvZCBpcyB0byBcInRhcCBpbnRvXCIgYSBtZXRob2QgY2hhaW4sIGluXG4gIC8vIG9yZGVyIHRvIHBlcmZvcm0gb3BlcmF0aW9ucyBvbiBpbnRlcm1lZGlhdGUgcmVzdWx0cyB3aXRoaW4gdGhlIGNoYWluLlxuICBfLnRhcCA9IGZ1bmN0aW9uKG9iaiwgaW50ZXJjZXB0b3IpIHtcbiAgICBpbnRlcmNlcHRvcihvYmopO1xuICAgIHJldHVybiBvYmo7XG4gIH07XG5cbiAgLy8gUmV0dXJucyB3aGV0aGVyIGFuIG9iamVjdCBoYXMgYSBnaXZlbiBzZXQgb2YgYGtleTp2YWx1ZWAgcGFpcnMuXG4gIF8uaXNNYXRjaCA9IGZ1bmN0aW9uKG9iamVjdCwgYXR0cnMpIHtcbiAgICB2YXIga2V5cyA9IF8ua2V5cyhhdHRycyksIGxlbmd0aCA9IGtleXMubGVuZ3RoO1xuICAgIGlmIChvYmplY3QgPT0gbnVsbCkgcmV0dXJuICFsZW5ndGg7XG4gICAgdmFyIG9iaiA9IE9iamVjdChvYmplY3QpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgaWYgKGF0dHJzW2tleV0gIT09IG9ialtrZXldIHx8ICEoa2V5IGluIG9iaikpIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cblxuICAvLyBJbnRlcm5hbCByZWN1cnNpdmUgY29tcGFyaXNvbiBmdW5jdGlvbiBmb3IgYGlzRXF1YWxgLlxuICB2YXIgZXEgPSBmdW5jdGlvbihhLCBiLCBhU3RhY2ssIGJTdGFjaykge1xuICAgIC8vIElkZW50aWNhbCBvYmplY3RzIGFyZSBlcXVhbC4gYDAgPT09IC0wYCwgYnV0IHRoZXkgYXJlbid0IGlkZW50aWNhbC5cbiAgICAvLyBTZWUgdGhlIFtIYXJtb255IGBlZ2FsYCBwcm9wb3NhbF0oaHR0cDovL3dpa2kuZWNtYXNjcmlwdC5vcmcvZG9rdS5waHA/aWQ9aGFybW9ueTplZ2FsKS5cbiAgICBpZiAoYSA9PT0gYikgcmV0dXJuIGEgIT09IDAgfHwgMSAvIGEgPT09IDEgLyBiO1xuICAgIC8vIEEgc3RyaWN0IGNvbXBhcmlzb24gaXMgbmVjZXNzYXJ5IGJlY2F1c2UgYG51bGwgPT0gdW5kZWZpbmVkYC5cbiAgICBpZiAoYSA9PSBudWxsIHx8IGIgPT0gbnVsbCkgcmV0dXJuIGEgPT09IGI7XG4gICAgLy8gVW53cmFwIGFueSB3cmFwcGVkIG9iamVjdHMuXG4gICAgaWYgKGEgaW5zdGFuY2VvZiBfKSBhID0gYS5fd3JhcHBlZDtcbiAgICBpZiAoYiBpbnN0YW5jZW9mIF8pIGIgPSBiLl93cmFwcGVkO1xuICAgIC8vIENvbXBhcmUgYFtbQ2xhc3NdXWAgbmFtZXMuXG4gICAgdmFyIGNsYXNzTmFtZSA9IHRvU3RyaW5nLmNhbGwoYSk7XG4gICAgaWYgKGNsYXNzTmFtZSAhPT0gdG9TdHJpbmcuY2FsbChiKSkgcmV0dXJuIGZhbHNlO1xuICAgIHN3aXRjaCAoY2xhc3NOYW1lKSB7XG4gICAgICAvLyBTdHJpbmdzLCBudW1iZXJzLCByZWd1bGFyIGV4cHJlc3Npb25zLCBkYXRlcywgYW5kIGJvb2xlYW5zIGFyZSBjb21wYXJlZCBieSB2YWx1ZS5cbiAgICAgIGNhc2UgJ1tvYmplY3QgUmVnRXhwXSc6XG4gICAgICAvLyBSZWdFeHBzIGFyZSBjb2VyY2VkIHRvIHN0cmluZ3MgZm9yIGNvbXBhcmlzb24gKE5vdGU6ICcnICsgL2EvaSA9PT0gJy9hL2knKVxuICAgICAgY2FzZSAnW29iamVjdCBTdHJpbmddJzpcbiAgICAgICAgLy8gUHJpbWl0aXZlcyBhbmQgdGhlaXIgY29ycmVzcG9uZGluZyBvYmplY3Qgd3JhcHBlcnMgYXJlIGVxdWl2YWxlbnQ7IHRodXMsIGBcIjVcImAgaXNcbiAgICAgICAgLy8gZXF1aXZhbGVudCB0byBgbmV3IFN0cmluZyhcIjVcIilgLlxuICAgICAgICByZXR1cm4gJycgKyBhID09PSAnJyArIGI7XG4gICAgICBjYXNlICdbb2JqZWN0IE51bWJlcl0nOlxuICAgICAgICAvLyBgTmFOYHMgYXJlIGVxdWl2YWxlbnQsIGJ1dCBub24tcmVmbGV4aXZlLlxuICAgICAgICAvLyBPYmplY3QoTmFOKSBpcyBlcXVpdmFsZW50IHRvIE5hTlxuICAgICAgICBpZiAoK2EgIT09ICthKSByZXR1cm4gK2IgIT09ICtiO1xuICAgICAgICAvLyBBbiBgZWdhbGAgY29tcGFyaXNvbiBpcyBwZXJmb3JtZWQgZm9yIG90aGVyIG51bWVyaWMgdmFsdWVzLlxuICAgICAgICByZXR1cm4gK2EgPT09IDAgPyAxIC8gK2EgPT09IDEgLyBiIDogK2EgPT09ICtiO1xuICAgICAgY2FzZSAnW29iamVjdCBEYXRlXSc6XG4gICAgICBjYXNlICdbb2JqZWN0IEJvb2xlYW5dJzpcbiAgICAgICAgLy8gQ29lcmNlIGRhdGVzIGFuZCBib29sZWFucyB0byBudW1lcmljIHByaW1pdGl2ZSB2YWx1ZXMuIERhdGVzIGFyZSBjb21wYXJlZCBieSB0aGVpclxuICAgICAgICAvLyBtaWxsaXNlY29uZCByZXByZXNlbnRhdGlvbnMuIE5vdGUgdGhhdCBpbnZhbGlkIGRhdGVzIHdpdGggbWlsbGlzZWNvbmQgcmVwcmVzZW50YXRpb25zXG4gICAgICAgIC8vIG9mIGBOYU5gIGFyZSBub3QgZXF1aXZhbGVudC5cbiAgICAgICAgcmV0dXJuICthID09PSArYjtcbiAgICB9XG5cbiAgICB2YXIgYXJlQXJyYXlzID0gY2xhc3NOYW1lID09PSAnW29iamVjdCBBcnJheV0nO1xuICAgIGlmICghYXJlQXJyYXlzKSB7XG4gICAgICBpZiAodHlwZW9mIGEgIT0gJ29iamVjdCcgfHwgdHlwZW9mIGIgIT0gJ29iamVjdCcpIHJldHVybiBmYWxzZTtcblxuICAgICAgLy8gT2JqZWN0cyB3aXRoIGRpZmZlcmVudCBjb25zdHJ1Y3RvcnMgYXJlIG5vdCBlcXVpdmFsZW50LCBidXQgYE9iamVjdGBzIG9yIGBBcnJheWBzXG4gICAgICAvLyBmcm9tIGRpZmZlcmVudCBmcmFtZXMgYXJlLlxuICAgICAgdmFyIGFDdG9yID0gYS5jb25zdHJ1Y3RvciwgYkN0b3IgPSBiLmNvbnN0cnVjdG9yO1xuICAgICAgaWYgKGFDdG9yICE9PSBiQ3RvciAmJiAhKF8uaXNGdW5jdGlvbihhQ3RvcikgJiYgYUN0b3IgaW5zdGFuY2VvZiBhQ3RvciAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF8uaXNGdW5jdGlvbihiQ3RvcikgJiYgYkN0b3IgaW5zdGFuY2VvZiBiQ3RvcilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgJiYgKCdjb25zdHJ1Y3RvcicgaW4gYSAmJiAnY29uc3RydWN0b3InIGluIGIpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gQXNzdW1lIGVxdWFsaXR5IGZvciBjeWNsaWMgc3RydWN0dXJlcy4gVGhlIGFsZ29yaXRobSBmb3IgZGV0ZWN0aW5nIGN5Y2xpY1xuICAgIC8vIHN0cnVjdHVyZXMgaXMgYWRhcHRlZCBmcm9tIEVTIDUuMSBzZWN0aW9uIDE1LjEyLjMsIGFic3RyYWN0IG9wZXJhdGlvbiBgSk9gLlxuXG4gICAgLy8gSW5pdGlhbGl6aW5nIHN0YWNrIG9mIHRyYXZlcnNlZCBvYmplY3RzLlxuICAgIC8vIEl0J3MgZG9uZSBoZXJlIHNpbmNlIHdlIG9ubHkgbmVlZCB0aGVtIGZvciBvYmplY3RzIGFuZCBhcnJheXMgY29tcGFyaXNvbi5cbiAgICBhU3RhY2sgPSBhU3RhY2sgfHwgW107XG4gICAgYlN0YWNrID0gYlN0YWNrIHx8IFtdO1xuICAgIHZhciBsZW5ndGggPSBhU3RhY2subGVuZ3RoO1xuICAgIHdoaWxlIChsZW5ndGgtLSkge1xuICAgICAgLy8gTGluZWFyIHNlYXJjaC4gUGVyZm9ybWFuY2UgaXMgaW52ZXJzZWx5IHByb3BvcnRpb25hbCB0byB0aGUgbnVtYmVyIG9mXG4gICAgICAvLyB1bmlxdWUgbmVzdGVkIHN0cnVjdHVyZXMuXG4gICAgICBpZiAoYVN0YWNrW2xlbmd0aF0gPT09IGEpIHJldHVybiBiU3RhY2tbbGVuZ3RoXSA9PT0gYjtcbiAgICB9XG5cbiAgICAvLyBBZGQgdGhlIGZpcnN0IG9iamVjdCB0byB0aGUgc3RhY2sgb2YgdHJhdmVyc2VkIG9iamVjdHMuXG4gICAgYVN0YWNrLnB1c2goYSk7XG4gICAgYlN0YWNrLnB1c2goYik7XG5cbiAgICAvLyBSZWN1cnNpdmVseSBjb21wYXJlIG9iamVjdHMgYW5kIGFycmF5cy5cbiAgICBpZiAoYXJlQXJyYXlzKSB7XG4gICAgICAvLyBDb21wYXJlIGFycmF5IGxlbmd0aHMgdG8gZGV0ZXJtaW5lIGlmIGEgZGVlcCBjb21wYXJpc29uIGlzIG5lY2Vzc2FyeS5cbiAgICAgIGxlbmd0aCA9IGEubGVuZ3RoO1xuICAgICAgaWYgKGxlbmd0aCAhPT0gYi5sZW5ndGgpIHJldHVybiBmYWxzZTtcbiAgICAgIC8vIERlZXAgY29tcGFyZSB0aGUgY29udGVudHMsIGlnbm9yaW5nIG5vbi1udW1lcmljIHByb3BlcnRpZXMuXG4gICAgICB3aGlsZSAobGVuZ3RoLS0pIHtcbiAgICAgICAgaWYgKCFlcShhW2xlbmd0aF0sIGJbbGVuZ3RoXSwgYVN0YWNrLCBiU3RhY2spKSByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIERlZXAgY29tcGFyZSBvYmplY3RzLlxuICAgICAgdmFyIGtleXMgPSBfLmtleXMoYSksIGtleTtcbiAgICAgIGxlbmd0aCA9IGtleXMubGVuZ3RoO1xuICAgICAgLy8gRW5zdXJlIHRoYXQgYm90aCBvYmplY3RzIGNvbnRhaW4gdGhlIHNhbWUgbnVtYmVyIG9mIHByb3BlcnRpZXMgYmVmb3JlIGNvbXBhcmluZyBkZWVwIGVxdWFsaXR5LlxuICAgICAgaWYgKF8ua2V5cyhiKS5sZW5ndGggIT09IGxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgICAgd2hpbGUgKGxlbmd0aC0tKSB7XG4gICAgICAgIC8vIERlZXAgY29tcGFyZSBlYWNoIG1lbWJlclxuICAgICAgICBrZXkgPSBrZXlzW2xlbmd0aF07XG4gICAgICAgIGlmICghKF8uaGFzKGIsIGtleSkgJiYgZXEoYVtrZXldLCBiW2tleV0sIGFTdGFjaywgYlN0YWNrKSkpIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gUmVtb3ZlIHRoZSBmaXJzdCBvYmplY3QgZnJvbSB0aGUgc3RhY2sgb2YgdHJhdmVyc2VkIG9iamVjdHMuXG4gICAgYVN0YWNrLnBvcCgpO1xuICAgIGJTdGFjay5wb3AoKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICAvLyBQZXJmb3JtIGEgZGVlcCBjb21wYXJpc29uIHRvIGNoZWNrIGlmIHR3byBvYmplY3RzIGFyZSBlcXVhbC5cbiAgXy5pc0VxdWFsID0gZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBlcShhLCBiKTtcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIGFycmF5LCBzdHJpbmcsIG9yIG9iamVjdCBlbXB0eT9cbiAgLy8gQW4gXCJlbXB0eVwiIG9iamVjdCBoYXMgbm8gZW51bWVyYWJsZSBvd24tcHJvcGVydGllcy5cbiAgXy5pc0VtcHR5ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgaWYgKG9iaiA9PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoaXNBcnJheUxpa2Uob2JqKSAmJiAoXy5pc0FycmF5KG9iaikgfHwgXy5pc1N0cmluZyhvYmopIHx8IF8uaXNBcmd1bWVudHMob2JqKSkpIHJldHVybiBvYmoubGVuZ3RoID09PSAwO1xuICAgIHJldHVybiBfLmtleXMob2JqKS5sZW5ndGggPT09IDA7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YWx1ZSBhIERPTSBlbGVtZW50P1xuICBfLmlzRWxlbWVudCA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiAhIShvYmogJiYgb2JqLm5vZGVUeXBlID09PSAxKTtcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIHZhbHVlIGFuIGFycmF5P1xuICAvLyBEZWxlZ2F0ZXMgdG8gRUNNQTUncyBuYXRpdmUgQXJyYXkuaXNBcnJheVxuICBfLmlzQXJyYXkgPSBuYXRpdmVJc0FycmF5IHx8IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiB0b1N0cmluZy5jYWxsKG9iaikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YXJpYWJsZSBhbiBvYmplY3Q/XG4gIF8uaXNPYmplY3QgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgdHlwZSA9IHR5cGVvZiBvYmo7XG4gICAgcmV0dXJuIHR5cGUgPT09ICdmdW5jdGlvbicgfHwgdHlwZSA9PT0gJ29iamVjdCcgJiYgISFvYmo7XG4gIH07XG5cbiAgLy8gQWRkIHNvbWUgaXNUeXBlIG1ldGhvZHM6IGlzQXJndW1lbnRzLCBpc0Z1bmN0aW9uLCBpc1N0cmluZywgaXNOdW1iZXIsIGlzRGF0ZSwgaXNSZWdFeHAsIGlzRXJyb3IuXG4gIF8uZWFjaChbJ0FyZ3VtZW50cycsICdGdW5jdGlvbicsICdTdHJpbmcnLCAnTnVtYmVyJywgJ0RhdGUnLCAnUmVnRXhwJywgJ0Vycm9yJ10sIGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBfWydpcycgKyBuYW1lXSA9IGZ1bmN0aW9uKG9iaikge1xuICAgICAgcmV0dXJuIHRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgJyArIG5hbWUgKyAnXSc7XG4gICAgfTtcbiAgfSk7XG5cbiAgLy8gRGVmaW5lIGEgZmFsbGJhY2sgdmVyc2lvbiBvZiB0aGUgbWV0aG9kIGluIGJyb3dzZXJzIChhaGVtLCBJRSA8IDkpLCB3aGVyZVxuICAvLyB0aGVyZSBpc24ndCBhbnkgaW5zcGVjdGFibGUgXCJBcmd1bWVudHNcIiB0eXBlLlxuICBpZiAoIV8uaXNBcmd1bWVudHMoYXJndW1lbnRzKSkge1xuICAgIF8uaXNBcmd1bWVudHMgPSBmdW5jdGlvbihvYmopIHtcbiAgICAgIHJldHVybiBfLmhhcyhvYmosICdjYWxsZWUnKTtcbiAgICB9O1xuICB9XG5cbiAgLy8gT3B0aW1pemUgYGlzRnVuY3Rpb25gIGlmIGFwcHJvcHJpYXRlLiBXb3JrIGFyb3VuZCBzb21lIHR5cGVvZiBidWdzIGluIG9sZCB2OCxcbiAgLy8gSUUgMTEgKCMxNjIxKSwgYW5kIGluIFNhZmFyaSA4ICgjMTkyOSkuXG4gIGlmICh0eXBlb2YgLy4vICE9ICdmdW5jdGlvbicgJiYgdHlwZW9mIEludDhBcnJheSAhPSAnb2JqZWN0Jykge1xuICAgIF8uaXNGdW5jdGlvbiA9IGZ1bmN0aW9uKG9iaikge1xuICAgICAgcmV0dXJuIHR5cGVvZiBvYmogPT0gJ2Z1bmN0aW9uJyB8fCBmYWxzZTtcbiAgICB9O1xuICB9XG5cbiAgLy8gSXMgYSBnaXZlbiBvYmplY3QgYSBmaW5pdGUgbnVtYmVyP1xuICBfLmlzRmluaXRlID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIGlzRmluaXRlKG9iaikgJiYgIWlzTmFOKHBhcnNlRmxvYXQob2JqKSk7XG4gIH07XG5cbiAgLy8gSXMgdGhlIGdpdmVuIHZhbHVlIGBOYU5gPyAoTmFOIGlzIHRoZSBvbmx5IG51bWJlciB3aGljaCBkb2VzIG5vdCBlcXVhbCBpdHNlbGYpLlxuICBfLmlzTmFOID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIF8uaXNOdW1iZXIob2JqKSAmJiBvYmogIT09ICtvYmo7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YWx1ZSBhIGJvb2xlYW4/XG4gIF8uaXNCb29sZWFuID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIG9iaiA9PT0gdHJ1ZSB8fCBvYmogPT09IGZhbHNlIHx8IHRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQm9vbGVhbl0nO1xuICB9O1xuXG4gIC8vIElzIGEgZ2l2ZW4gdmFsdWUgZXF1YWwgdG8gbnVsbD9cbiAgXy5pc051bGwgPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gb2JqID09PSBudWxsO1xuICB9O1xuXG4gIC8vIElzIGEgZ2l2ZW4gdmFyaWFibGUgdW5kZWZpbmVkP1xuICBfLmlzVW5kZWZpbmVkID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIG9iaiA9PT0gdm9pZCAwO1xuICB9O1xuXG4gIC8vIFNob3J0Y3V0IGZ1bmN0aW9uIGZvciBjaGVja2luZyBpZiBhbiBvYmplY3QgaGFzIGEgZ2l2ZW4gcHJvcGVydHkgZGlyZWN0bHlcbiAgLy8gb24gaXRzZWxmIChpbiBvdGhlciB3b3Jkcywgbm90IG9uIGEgcHJvdG90eXBlKS5cbiAgXy5oYXMgPSBmdW5jdGlvbihvYmosIGtleSkge1xuICAgIHJldHVybiBvYmogIT0gbnVsbCAmJiBoYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwga2V5KTtcbiAgfTtcblxuICAvLyBVdGlsaXR5IEZ1bmN0aW9uc1xuICAvLyAtLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8vIFJ1biBVbmRlcnNjb3JlLmpzIGluICpub0NvbmZsaWN0KiBtb2RlLCByZXR1cm5pbmcgdGhlIGBfYCB2YXJpYWJsZSB0byBpdHNcbiAgLy8gcHJldmlvdXMgb3duZXIuIFJldHVybnMgYSByZWZlcmVuY2UgdG8gdGhlIFVuZGVyc2NvcmUgb2JqZWN0LlxuICBfLm5vQ29uZmxpY3QgPSBmdW5jdGlvbigpIHtcbiAgICByb290Ll8gPSBwcmV2aW91c1VuZGVyc2NvcmU7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH07XG5cbiAgLy8gS2VlcCB0aGUgaWRlbnRpdHkgZnVuY3Rpb24gYXJvdW5kIGZvciBkZWZhdWx0IGl0ZXJhdGVlcy5cbiAgXy5pZGVudGl0eSA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9O1xuXG4gIC8vIFByZWRpY2F0ZS1nZW5lcmF0aW5nIGZ1bmN0aW9ucy4gT2Z0ZW4gdXNlZnVsIG91dHNpZGUgb2YgVW5kZXJzY29yZS5cbiAgXy5jb25zdGFudCA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH07XG4gIH07XG5cbiAgXy5ub29wID0gZnVuY3Rpb24oKXt9O1xuXG4gIF8ucHJvcGVydHkgPSBwcm9wZXJ0eTtcblxuICAvLyBHZW5lcmF0ZXMgYSBmdW5jdGlvbiBmb3IgYSBnaXZlbiBvYmplY3QgdGhhdCByZXR1cm5zIGEgZ2l2ZW4gcHJvcGVydHkuXG4gIF8ucHJvcGVydHlPZiA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiBvYmogPT0gbnVsbCA/IGZ1bmN0aW9uKCl7fSA6IGZ1bmN0aW9uKGtleSkge1xuICAgICAgcmV0dXJuIG9ialtrZXldO1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIHByZWRpY2F0ZSBmb3IgY2hlY2tpbmcgd2hldGhlciBhbiBvYmplY3QgaGFzIGEgZ2l2ZW4gc2V0IG9mXG4gIC8vIGBrZXk6dmFsdWVgIHBhaXJzLlxuICBfLm1hdGNoZXIgPSBfLm1hdGNoZXMgPSBmdW5jdGlvbihhdHRycykge1xuICAgIGF0dHJzID0gXy5leHRlbmRPd24oe30sIGF0dHJzKTtcbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gXy5pc01hdGNoKG9iaiwgYXR0cnMpO1xuICAgIH07XG4gIH07XG5cbiAgLy8gUnVuIGEgZnVuY3Rpb24gKipuKiogdGltZXMuXG4gIF8udGltZXMgPSBmdW5jdGlvbihuLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIHZhciBhY2N1bSA9IEFycmF5KE1hdGgubWF4KDAsIG4pKTtcbiAgICBpdGVyYXRlZSA9IG9wdGltaXplQ2IoaXRlcmF0ZWUsIGNvbnRleHQsIDEpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbjsgaSsrKSBhY2N1bVtpXSA9IGl0ZXJhdGVlKGkpO1xuICAgIHJldHVybiBhY2N1bTtcbiAgfTtcblxuICAvLyBSZXR1cm4gYSByYW5kb20gaW50ZWdlciBiZXR3ZWVuIG1pbiBhbmQgbWF4IChpbmNsdXNpdmUpLlxuICBfLnJhbmRvbSA9IGZ1bmN0aW9uKG1pbiwgbWF4KSB7XG4gICAgaWYgKG1heCA9PSBudWxsKSB7XG4gICAgICBtYXggPSBtaW47XG4gICAgICBtaW4gPSAwO1xuICAgIH1cbiAgICByZXR1cm4gbWluICsgTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKG1heCAtIG1pbiArIDEpKTtcbiAgfTtcblxuICAvLyBBIChwb3NzaWJseSBmYXN0ZXIpIHdheSB0byBnZXQgdGhlIGN1cnJlbnQgdGltZXN0YW1wIGFzIGFuIGludGVnZXIuXG4gIF8ubm93ID0gRGF0ZS5ub3cgfHwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICB9O1xuXG4gICAvLyBMaXN0IG9mIEhUTUwgZW50aXRpZXMgZm9yIGVzY2FwaW5nLlxuICB2YXIgZXNjYXBlTWFwID0ge1xuICAgICcmJzogJyZhbXA7JyxcbiAgICAnPCc6ICcmbHQ7JyxcbiAgICAnPic6ICcmZ3Q7JyxcbiAgICAnXCInOiAnJnF1b3Q7JyxcbiAgICBcIidcIjogJyYjeDI3OycsXG4gICAgJ2AnOiAnJiN4NjA7J1xuICB9O1xuICB2YXIgdW5lc2NhcGVNYXAgPSBfLmludmVydChlc2NhcGVNYXApO1xuXG4gIC8vIEZ1bmN0aW9ucyBmb3IgZXNjYXBpbmcgYW5kIHVuZXNjYXBpbmcgc3RyaW5ncyB0by9mcm9tIEhUTUwgaW50ZXJwb2xhdGlvbi5cbiAgdmFyIGNyZWF0ZUVzY2FwZXIgPSBmdW5jdGlvbihtYXApIHtcbiAgICB2YXIgZXNjYXBlciA9IGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgICByZXR1cm4gbWFwW21hdGNoXTtcbiAgICB9O1xuICAgIC8vIFJlZ2V4ZXMgZm9yIGlkZW50aWZ5aW5nIGEga2V5IHRoYXQgbmVlZHMgdG8gYmUgZXNjYXBlZFxuICAgIHZhciBzb3VyY2UgPSAnKD86JyArIF8ua2V5cyhtYXApLmpvaW4oJ3wnKSArICcpJztcbiAgICB2YXIgdGVzdFJlZ2V4cCA9IFJlZ0V4cChzb3VyY2UpO1xuICAgIHZhciByZXBsYWNlUmVnZXhwID0gUmVnRXhwKHNvdXJjZSwgJ2cnKTtcbiAgICByZXR1cm4gZnVuY3Rpb24oc3RyaW5nKSB7XG4gICAgICBzdHJpbmcgPSBzdHJpbmcgPT0gbnVsbCA/ICcnIDogJycgKyBzdHJpbmc7XG4gICAgICByZXR1cm4gdGVzdFJlZ2V4cC50ZXN0KHN0cmluZykgPyBzdHJpbmcucmVwbGFjZShyZXBsYWNlUmVnZXhwLCBlc2NhcGVyKSA6IHN0cmluZztcbiAgICB9O1xuICB9O1xuICBfLmVzY2FwZSA9IGNyZWF0ZUVzY2FwZXIoZXNjYXBlTWFwKTtcbiAgXy51bmVzY2FwZSA9IGNyZWF0ZUVzY2FwZXIodW5lc2NhcGVNYXApO1xuXG4gIC8vIElmIHRoZSB2YWx1ZSBvZiB0aGUgbmFtZWQgYHByb3BlcnR5YCBpcyBhIGZ1bmN0aW9uIHRoZW4gaW52b2tlIGl0IHdpdGggdGhlXG4gIC8vIGBvYmplY3RgIGFzIGNvbnRleHQ7IG90aGVyd2lzZSwgcmV0dXJuIGl0LlxuICBfLnJlc3VsdCA9IGZ1bmN0aW9uKG9iamVjdCwgcHJvcGVydHksIGZhbGxiYWNrKSB7XG4gICAgdmFyIHZhbHVlID0gb2JqZWN0ID09IG51bGwgPyB2b2lkIDAgOiBvYmplY3RbcHJvcGVydHldO1xuICAgIGlmICh2YWx1ZSA9PT0gdm9pZCAwKSB7XG4gICAgICB2YWx1ZSA9IGZhbGxiYWNrO1xuICAgIH1cbiAgICByZXR1cm4gXy5pc0Z1bmN0aW9uKHZhbHVlKSA/IHZhbHVlLmNhbGwob2JqZWN0KSA6IHZhbHVlO1xuICB9O1xuXG4gIC8vIEdlbmVyYXRlIGEgdW5pcXVlIGludGVnZXIgaWQgKHVuaXF1ZSB3aXRoaW4gdGhlIGVudGlyZSBjbGllbnQgc2Vzc2lvbikuXG4gIC8vIFVzZWZ1bCBmb3IgdGVtcG9yYXJ5IERPTSBpZHMuXG4gIHZhciBpZENvdW50ZXIgPSAwO1xuICBfLnVuaXF1ZUlkID0gZnVuY3Rpb24ocHJlZml4KSB7XG4gICAgdmFyIGlkID0gKytpZENvdW50ZXIgKyAnJztcbiAgICByZXR1cm4gcHJlZml4ID8gcHJlZml4ICsgaWQgOiBpZDtcbiAgfTtcblxuICAvLyBCeSBkZWZhdWx0LCBVbmRlcnNjb3JlIHVzZXMgRVJCLXN0eWxlIHRlbXBsYXRlIGRlbGltaXRlcnMsIGNoYW5nZSB0aGVcbiAgLy8gZm9sbG93aW5nIHRlbXBsYXRlIHNldHRpbmdzIHRvIHVzZSBhbHRlcm5hdGl2ZSBkZWxpbWl0ZXJzLlxuICBfLnRlbXBsYXRlU2V0dGluZ3MgPSB7XG4gICAgZXZhbHVhdGUgICAgOiAvPCUoW1xcc1xcU10rPyklPi9nLFxuICAgIGludGVycG9sYXRlIDogLzwlPShbXFxzXFxTXSs/KSU+L2csXG4gICAgZXNjYXBlICAgICAgOiAvPCUtKFtcXHNcXFNdKz8pJT4vZ1xuICB9O1xuXG4gIC8vIFdoZW4gY3VzdG9taXppbmcgYHRlbXBsYXRlU2V0dGluZ3NgLCBpZiB5b3UgZG9uJ3Qgd2FudCB0byBkZWZpbmUgYW5cbiAgLy8gaW50ZXJwb2xhdGlvbiwgZXZhbHVhdGlvbiBvciBlc2NhcGluZyByZWdleCwgd2UgbmVlZCBvbmUgdGhhdCBpc1xuICAvLyBndWFyYW50ZWVkIG5vdCB0byBtYXRjaC5cbiAgdmFyIG5vTWF0Y2ggPSAvKC4pXi87XG5cbiAgLy8gQ2VydGFpbiBjaGFyYWN0ZXJzIG5lZWQgdG8gYmUgZXNjYXBlZCBzbyB0aGF0IHRoZXkgY2FuIGJlIHB1dCBpbnRvIGFcbiAgLy8gc3RyaW5nIGxpdGVyYWwuXG4gIHZhciBlc2NhcGVzID0ge1xuICAgIFwiJ1wiOiAgICAgIFwiJ1wiLFxuICAgICdcXFxcJzogICAgICdcXFxcJyxcbiAgICAnXFxyJzogICAgICdyJyxcbiAgICAnXFxuJzogICAgICduJyxcbiAgICAnXFx1MjAyOCc6ICd1MjAyOCcsXG4gICAgJ1xcdTIwMjknOiAndTIwMjknXG4gIH07XG5cbiAgdmFyIGVzY2FwZXIgPSAvXFxcXHwnfFxccnxcXG58XFx1MjAyOHxcXHUyMDI5L2c7XG5cbiAgdmFyIGVzY2FwZUNoYXIgPSBmdW5jdGlvbihtYXRjaCkge1xuICAgIHJldHVybiAnXFxcXCcgKyBlc2NhcGVzW21hdGNoXTtcbiAgfTtcblxuICAvLyBKYXZhU2NyaXB0IG1pY3JvLXRlbXBsYXRpbmcsIHNpbWlsYXIgdG8gSm9obiBSZXNpZydzIGltcGxlbWVudGF0aW9uLlxuICAvLyBVbmRlcnNjb3JlIHRlbXBsYXRpbmcgaGFuZGxlcyBhcmJpdHJhcnkgZGVsaW1pdGVycywgcHJlc2VydmVzIHdoaXRlc3BhY2UsXG4gIC8vIGFuZCBjb3JyZWN0bHkgZXNjYXBlcyBxdW90ZXMgd2l0aGluIGludGVycG9sYXRlZCBjb2RlLlxuICAvLyBOQjogYG9sZFNldHRpbmdzYCBvbmx5IGV4aXN0cyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHkuXG4gIF8udGVtcGxhdGUgPSBmdW5jdGlvbih0ZXh0LCBzZXR0aW5ncywgb2xkU2V0dGluZ3MpIHtcbiAgICBpZiAoIXNldHRpbmdzICYmIG9sZFNldHRpbmdzKSBzZXR0aW5ncyA9IG9sZFNldHRpbmdzO1xuICAgIHNldHRpbmdzID0gXy5kZWZhdWx0cyh7fSwgc2V0dGluZ3MsIF8udGVtcGxhdGVTZXR0aW5ncyk7XG5cbiAgICAvLyBDb21iaW5lIGRlbGltaXRlcnMgaW50byBvbmUgcmVndWxhciBleHByZXNzaW9uIHZpYSBhbHRlcm5hdGlvbi5cbiAgICB2YXIgbWF0Y2hlciA9IFJlZ0V4cChbXG4gICAgICAoc2V0dGluZ3MuZXNjYXBlIHx8IG5vTWF0Y2gpLnNvdXJjZSxcbiAgICAgIChzZXR0aW5ncy5pbnRlcnBvbGF0ZSB8fCBub01hdGNoKS5zb3VyY2UsXG4gICAgICAoc2V0dGluZ3MuZXZhbHVhdGUgfHwgbm9NYXRjaCkuc291cmNlXG4gICAgXS5qb2luKCd8JykgKyAnfCQnLCAnZycpO1xuXG4gICAgLy8gQ29tcGlsZSB0aGUgdGVtcGxhdGUgc291cmNlLCBlc2NhcGluZyBzdHJpbmcgbGl0ZXJhbHMgYXBwcm9wcmlhdGVseS5cbiAgICB2YXIgaW5kZXggPSAwO1xuICAgIHZhciBzb3VyY2UgPSBcIl9fcCs9J1wiO1xuICAgIHRleHQucmVwbGFjZShtYXRjaGVyLCBmdW5jdGlvbihtYXRjaCwgZXNjYXBlLCBpbnRlcnBvbGF0ZSwgZXZhbHVhdGUsIG9mZnNldCkge1xuICAgICAgc291cmNlICs9IHRleHQuc2xpY2UoaW5kZXgsIG9mZnNldCkucmVwbGFjZShlc2NhcGVyLCBlc2NhcGVDaGFyKTtcbiAgICAgIGluZGV4ID0gb2Zmc2V0ICsgbWF0Y2gubGVuZ3RoO1xuXG4gICAgICBpZiAoZXNjYXBlKSB7XG4gICAgICAgIHNvdXJjZSArPSBcIicrXFxuKChfX3Q9KFwiICsgZXNjYXBlICsgXCIpKT09bnVsbD8nJzpfLmVzY2FwZShfX3QpKStcXG4nXCI7XG4gICAgICB9IGVsc2UgaWYgKGludGVycG9sYXRlKSB7XG4gICAgICAgIHNvdXJjZSArPSBcIicrXFxuKChfX3Q9KFwiICsgaW50ZXJwb2xhdGUgKyBcIikpPT1udWxsPycnOl9fdCkrXFxuJ1wiO1xuICAgICAgfSBlbHNlIGlmIChldmFsdWF0ZSkge1xuICAgICAgICBzb3VyY2UgKz0gXCInO1xcblwiICsgZXZhbHVhdGUgKyBcIlxcbl9fcCs9J1wiO1xuICAgICAgfVxuXG4gICAgICAvLyBBZG9iZSBWTXMgbmVlZCB0aGUgbWF0Y2ggcmV0dXJuZWQgdG8gcHJvZHVjZSB0aGUgY29ycmVjdCBvZmZlc3QuXG4gICAgICByZXR1cm4gbWF0Y2g7XG4gICAgfSk7XG4gICAgc291cmNlICs9IFwiJztcXG5cIjtcblxuICAgIC8vIElmIGEgdmFyaWFibGUgaXMgbm90IHNwZWNpZmllZCwgcGxhY2UgZGF0YSB2YWx1ZXMgaW4gbG9jYWwgc2NvcGUuXG4gICAgaWYgKCFzZXR0aW5ncy52YXJpYWJsZSkgc291cmNlID0gJ3dpdGgob2JqfHx7fSl7XFxuJyArIHNvdXJjZSArICd9XFxuJztcblxuICAgIHNvdXJjZSA9IFwidmFyIF9fdCxfX3A9JycsX19qPUFycmF5LnByb3RvdHlwZS5qb2luLFwiICtcbiAgICAgIFwicHJpbnQ9ZnVuY3Rpb24oKXtfX3ArPV9fai5jYWxsKGFyZ3VtZW50cywnJyk7fTtcXG5cIiArXG4gICAgICBzb3VyY2UgKyAncmV0dXJuIF9fcDtcXG4nO1xuXG4gICAgdHJ5IHtcbiAgICAgIHZhciByZW5kZXIgPSBuZXcgRnVuY3Rpb24oc2V0dGluZ3MudmFyaWFibGUgfHwgJ29iaicsICdfJywgc291cmNlKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBlLnNvdXJjZSA9IHNvdXJjZTtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuXG4gICAgdmFyIHRlbXBsYXRlID0gZnVuY3Rpb24oZGF0YSkge1xuICAgICAgcmV0dXJuIHJlbmRlci5jYWxsKHRoaXMsIGRhdGEsIF8pO1xuICAgIH07XG5cbiAgICAvLyBQcm92aWRlIHRoZSBjb21waWxlZCBzb3VyY2UgYXMgYSBjb252ZW5pZW5jZSBmb3IgcHJlY29tcGlsYXRpb24uXG4gICAgdmFyIGFyZ3VtZW50ID0gc2V0dGluZ3MudmFyaWFibGUgfHwgJ29iaic7XG4gICAgdGVtcGxhdGUuc291cmNlID0gJ2Z1bmN0aW9uKCcgKyBhcmd1bWVudCArICcpe1xcbicgKyBzb3VyY2UgKyAnfSc7XG5cbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH07XG5cbiAgLy8gQWRkIGEgXCJjaGFpblwiIGZ1bmN0aW9uLiBTdGFydCBjaGFpbmluZyBhIHdyYXBwZWQgVW5kZXJzY29yZSBvYmplY3QuXG4gIF8uY2hhaW4gPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgaW5zdGFuY2UgPSBfKG9iaik7XG4gICAgaW5zdGFuY2UuX2NoYWluID0gdHJ1ZTtcbiAgICByZXR1cm4gaW5zdGFuY2U7XG4gIH07XG5cbiAgLy8gT09QXG4gIC8vIC0tLS0tLS0tLS0tLS0tLVxuICAvLyBJZiBVbmRlcnNjb3JlIGlzIGNhbGxlZCBhcyBhIGZ1bmN0aW9uLCBpdCByZXR1cm5zIGEgd3JhcHBlZCBvYmplY3QgdGhhdFxuICAvLyBjYW4gYmUgdXNlZCBPTy1zdHlsZS4gVGhpcyB3cmFwcGVyIGhvbGRzIGFsdGVyZWQgdmVyc2lvbnMgb2YgYWxsIHRoZVxuICAvLyB1bmRlcnNjb3JlIGZ1bmN0aW9ucy4gV3JhcHBlZCBvYmplY3RzIG1heSBiZSBjaGFpbmVkLlxuXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBjb250aW51ZSBjaGFpbmluZyBpbnRlcm1lZGlhdGUgcmVzdWx0cy5cbiAgdmFyIHJlc3VsdCA9IGZ1bmN0aW9uKGluc3RhbmNlLCBvYmopIHtcbiAgICByZXR1cm4gaW5zdGFuY2UuX2NoYWluID8gXyhvYmopLmNoYWluKCkgOiBvYmo7XG4gIH07XG5cbiAgLy8gQWRkIHlvdXIgb3duIGN1c3RvbSBmdW5jdGlvbnMgdG8gdGhlIFVuZGVyc2NvcmUgb2JqZWN0LlxuICBfLm1peGluID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgXy5lYWNoKF8uZnVuY3Rpb25zKG9iaiksIGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIHZhciBmdW5jID0gX1tuYW1lXSA9IG9ialtuYW1lXTtcbiAgICAgIF8ucHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBhcmdzID0gW3RoaXMuX3dyYXBwZWRdO1xuICAgICAgICBwdXNoLmFwcGx5KGFyZ3MsIGFyZ3VtZW50cyk7XG4gICAgICAgIHJldHVybiByZXN1bHQodGhpcywgZnVuYy5hcHBseShfLCBhcmdzKSk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIEFkZCBhbGwgb2YgdGhlIFVuZGVyc2NvcmUgZnVuY3Rpb25zIHRvIHRoZSB3cmFwcGVyIG9iamVjdC5cbiAgXy5taXhpbihfKTtcblxuICAvLyBBZGQgYWxsIG11dGF0b3IgQXJyYXkgZnVuY3Rpb25zIHRvIHRoZSB3cmFwcGVyLlxuICBfLmVhY2goWydwb3AnLCAncHVzaCcsICdyZXZlcnNlJywgJ3NoaWZ0JywgJ3NvcnQnLCAnc3BsaWNlJywgJ3Vuc2hpZnQnXSwgZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBtZXRob2QgPSBBcnJheVByb3RvW25hbWVdO1xuICAgIF8ucHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgb2JqID0gdGhpcy5fd3JhcHBlZDtcbiAgICAgIG1ldGhvZC5hcHBseShvYmosIGFyZ3VtZW50cyk7XG4gICAgICBpZiAoKG5hbWUgPT09ICdzaGlmdCcgfHwgbmFtZSA9PT0gJ3NwbGljZScpICYmIG9iai5sZW5ndGggPT09IDApIGRlbGV0ZSBvYmpbMF07XG4gICAgICByZXR1cm4gcmVzdWx0KHRoaXMsIG9iaik7XG4gICAgfTtcbiAgfSk7XG5cbiAgLy8gQWRkIGFsbCBhY2Nlc3NvciBBcnJheSBmdW5jdGlvbnMgdG8gdGhlIHdyYXBwZXIuXG4gIF8uZWFjaChbJ2NvbmNhdCcsICdqb2luJywgJ3NsaWNlJ10sIGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgbWV0aG9kID0gQXJyYXlQcm90b1tuYW1lXTtcbiAgICBfLnByb3RvdHlwZVtuYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHJlc3VsdCh0aGlzLCBtZXRob2QuYXBwbHkodGhpcy5fd3JhcHBlZCwgYXJndW1lbnRzKSk7XG4gICAgfTtcbiAgfSk7XG5cbiAgLy8gRXh0cmFjdHMgdGhlIHJlc3VsdCBmcm9tIGEgd3JhcHBlZCBhbmQgY2hhaW5lZCBvYmplY3QuXG4gIF8ucHJvdG90eXBlLnZhbHVlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX3dyYXBwZWQ7XG4gIH07XG5cbiAgLy8gUHJvdmlkZSB1bndyYXBwaW5nIHByb3h5IGZvciBzb21lIG1ldGhvZHMgdXNlZCBpbiBlbmdpbmUgb3BlcmF0aW9uc1xuICAvLyBzdWNoIGFzIGFyaXRobWV0aWMgYW5kIEpTT04gc3RyaW5naWZpY2F0aW9uLlxuICBfLnByb3RvdHlwZS52YWx1ZU9mID0gXy5wcm90b3R5cGUudG9KU09OID0gXy5wcm90b3R5cGUudmFsdWU7XG5cbiAgXy5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gJycgKyB0aGlzLl93cmFwcGVkO1xuICB9O1xuXG4gIC8vIEFNRCByZWdpc3RyYXRpb24gaGFwcGVucyBhdCB0aGUgZW5kIGZvciBjb21wYXRpYmlsaXR5IHdpdGggQU1EIGxvYWRlcnNcbiAgLy8gdGhhdCBtYXkgbm90IGVuZm9yY2UgbmV4dC10dXJuIHNlbWFudGljcyBvbiBtb2R1bGVzLiBFdmVuIHRob3VnaCBnZW5lcmFsXG4gIC8vIHByYWN0aWNlIGZvciBBTUQgcmVnaXN0cmF0aW9uIGlzIHRvIGJlIGFub255bW91cywgdW5kZXJzY29yZSByZWdpc3RlcnNcbiAgLy8gYXMgYSBuYW1lZCBtb2R1bGUgYmVjYXVzZSwgbGlrZSBqUXVlcnksIGl0IGlzIGEgYmFzZSBsaWJyYXJ5IHRoYXQgaXNcbiAgLy8gcG9wdWxhciBlbm91Z2ggdG8gYmUgYnVuZGxlZCBpbiBhIHRoaXJkIHBhcnR5IGxpYiwgYnV0IG5vdCBiZSBwYXJ0IG9mXG4gIC8vIGFuIEFNRCBsb2FkIHJlcXVlc3QuIFRob3NlIGNhc2VzIGNvdWxkIGdlbmVyYXRlIGFuIGVycm9yIHdoZW4gYW5cbiAgLy8gYW5vbnltb3VzIGRlZmluZSgpIGlzIGNhbGxlZCBvdXRzaWRlIG9mIGEgbG9hZGVyIHJlcXVlc3QuXG4gIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgICBkZWZpbmUoJ3VuZGVyc2NvcmUnLCBbXSwgZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gXztcbiAgICB9KTtcbiAgfVxufS5jYWxsKHRoaXMpKTtcbiIsInZhciBidW5kbGVGbiA9IGFyZ3VtZW50c1szXTtcbnZhciBzb3VyY2VzID0gYXJndW1lbnRzWzRdO1xudmFyIGNhY2hlID0gYXJndW1lbnRzWzVdO1xuXG52YXIgc3RyaW5naWZ5ID0gSlNPTi5zdHJpbmdpZnk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGZuKSB7XG4gICAgdmFyIGtleXMgPSBbXTtcbiAgICB2YXIgd2tleTtcbiAgICB2YXIgY2FjaGVLZXlzID0gT2JqZWN0LmtleXMoY2FjaGUpO1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBjYWNoZUtleXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHZhciBrZXkgPSBjYWNoZUtleXNbaV07XG4gICAgICAgIHZhciBleHAgPSBjYWNoZVtrZXldLmV4cG9ydHM7XG4gICAgICAgIC8vIFVzaW5nIGJhYmVsIGFzIGEgdHJhbnNwaWxlciB0byB1c2UgZXNtb2R1bGUsIHRoZSBleHBvcnQgd2lsbCBhbHdheXNcbiAgICAgICAgLy8gYmUgYW4gb2JqZWN0IHdpdGggdGhlIGRlZmF1bHQgZXhwb3J0IGFzIGEgcHJvcGVydHkgb2YgaXQuIFRvIGVuc3VyZVxuICAgICAgICAvLyB0aGUgZXhpc3RpbmcgYXBpIGFuZCBiYWJlbCBlc21vZHVsZSBleHBvcnRzIGFyZSBib3RoIHN1cHBvcnRlZCB3ZVxuICAgICAgICAvLyBjaGVjayBmb3IgYm90aFxuICAgICAgICBpZiAoZXhwID09PSBmbiB8fCBleHAuZGVmYXVsdCA9PT0gZm4pIHtcbiAgICAgICAgICAgIHdrZXkgPSBrZXk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmICghd2tleSkge1xuICAgICAgICB3a2V5ID0gTWF0aC5mbG9vcihNYXRoLnBvdygxNiwgOCkgKiBNYXRoLnJhbmRvbSgpKS50b1N0cmluZygxNik7XG4gICAgICAgIHZhciB3Y2FjaGUgPSB7fTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBjYWNoZUtleXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIga2V5ID0gY2FjaGVLZXlzW2ldO1xuICAgICAgICAgICAgd2NhY2hlW2tleV0gPSBrZXk7XG4gICAgICAgIH1cbiAgICAgICAgc291cmNlc1t3a2V5XSA9IFtcbiAgICAgICAgICAgIEZ1bmN0aW9uKFsncmVxdWlyZScsJ21vZHVsZScsJ2V4cG9ydHMnXSwgJygnICsgZm4gKyAnKShzZWxmKScpLFxuICAgICAgICAgICAgd2NhY2hlXG4gICAgICAgIF07XG4gICAgfVxuICAgIHZhciBza2V5ID0gTWF0aC5mbG9vcihNYXRoLnBvdygxNiwgOCkgKiBNYXRoLnJhbmRvbSgpKS50b1N0cmluZygxNik7XG5cbiAgICB2YXIgc2NhY2hlID0ge307IHNjYWNoZVt3a2V5XSA9IHdrZXk7XG4gICAgc291cmNlc1tza2V5XSA9IFtcbiAgICAgICAgRnVuY3Rpb24oWydyZXF1aXJlJ10sIChcbiAgICAgICAgICAgIC8vIHRyeSB0byBjYWxsIGRlZmF1bHQgaWYgZGVmaW5lZCB0byBhbHNvIHN1cHBvcnQgYmFiZWwgZXNtb2R1bGVcbiAgICAgICAgICAgIC8vIGV4cG9ydHNcbiAgICAgICAgICAgICd2YXIgZiA9IHJlcXVpcmUoJyArIHN0cmluZ2lmeSh3a2V5KSArICcpOycgK1xuICAgICAgICAgICAgJyhmLmRlZmF1bHQgPyBmLmRlZmF1bHQgOiBmKShzZWxmKTsnXG4gICAgICAgICkpLFxuICAgICAgICBzY2FjaGVcbiAgICBdO1xuXG4gICAgdmFyIHNyYyA9ICcoJyArIGJ1bmRsZUZuICsgJykoeydcbiAgICAgICAgKyBPYmplY3Qua2V5cyhzb3VyY2VzKS5tYXAoZnVuY3Rpb24gKGtleSkge1xuICAgICAgICAgICAgcmV0dXJuIHN0cmluZ2lmeShrZXkpICsgJzpbJ1xuICAgICAgICAgICAgICAgICsgc291cmNlc1trZXldWzBdXG4gICAgICAgICAgICAgICAgKyAnLCcgKyBzdHJpbmdpZnkoc291cmNlc1trZXldWzFdKSArICddJ1xuICAgICAgICAgICAgO1xuICAgICAgICB9KS5qb2luKCcsJylcbiAgICAgICAgKyAnfSx7fSxbJyArIHN0cmluZ2lmeShza2V5KSArICddKSdcbiAgICA7XG5cbiAgICB2YXIgVVJMID0gd2luZG93LlVSTCB8fCB3aW5kb3cud2Via2l0VVJMIHx8IHdpbmRvdy5tb3pVUkwgfHwgd2luZG93Lm1zVVJMO1xuXG4gICAgcmV0dXJuIG5ldyBXb3JrZXIoVVJMLmNyZWF0ZU9iamVjdFVSTChcbiAgICAgICAgbmV3IEJsb2IoW3NyY10sIHsgdHlwZTogJ3RleHQvamF2YXNjcmlwdCcgfSlcbiAgICApKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgR3JhcGggPSByZXF1aXJlKCduZ3JhcGguZ3JhcGgnKTtcclxudmFyIF8gPSByZXF1aXJlKCd1bmRlcnNjb3JlJyk7XHJcbnZhciBRID0gcmVxdWlyZSgnUScpO1xyXG52YXIgTmxheW91dCA9IHJlcXVpcmUoJ25ncmFwaC5hc3luY2ZvcmNlJyk7XHJcbi8vIHJlZ2lzdGVycyB0aGUgZXh0ZW5zaW9uIG9uIGEgY3l0b3NjYXBlIGxpYiByZWZcclxuXHJcbnZhciBuZ3JhcGggPSBmdW5jdGlvbiAoY3l0b3NjYXBlKSB7XHJcblxyXG4gICAgaWYgKCFjeXRvc2NhcGUpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9IC8vIGNhbid0IHJlZ2lzdGVyIGlmIGN5dG9zY2FwZSB1bnNwZWNpZmllZFxyXG5cclxuICAgIHZhciBkZWZhdWx0cyA9IHtcclxuICAgICAgICBhc3luYzoge1xyXG4gICAgICAgICAgICAvLyB0ZWxsIGxheW91dCB0aGF0IHdlIHdhbnQgdG8gY29tcHV0ZSBhbGwgYXQgb25jZTpcclxuICAgICAgICAgICAgbWF4SXRlcmF0aW9uczogMTAwMCxcclxuICAgICAgICAgICAgc3RlcHNQZXJDeWNsZTogMzAsXHJcblxyXG4gICAgICAgICAgICAvLyBSdW4gaXQgdGlsbCB0aGUgZW5kOlxyXG4gICAgICAgICAgICB3YWl0Rm9yU3RlcDogZmFsc2VcclxuICAgICAgICB9LFxyXG4gICAgICAgIHBoeXNpY3M6IHtcclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICAqIElkZWFsIGxlbmd0aCBmb3IgbGlua3MgKHNwcmluZ3MgaW4gcGh5c2ljYWwgbW9kZWwpLlxyXG4gICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgc3ByaW5nTGVuZ3RoOiAxMDAsXHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgICogSG9vaydzIGxhdyBjb2VmZmljaWVudC4gMSAtIHNvbGlkIHNwcmluZy5cclxuICAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIHNwcmluZ0NvZWZmOiAwLjAwMDgsXHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgICogQ291bG9tYidzIGxhdyBjb2VmZmljaWVudC4gSXQncyB1c2VkIHRvIHJlcGVsIG5vZGVzIHRodXMgc2hvdWxkIGJlIG5lZ2F0aXZlXHJcbiAgICAgICAgICAgICAqIGlmIHlvdSBtYWtlIGl0IHBvc2l0aXZlIG5vZGVzIHN0YXJ0IGF0dHJhY3QgZWFjaCBvdGhlciA6KS5cclxuICAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGdyYXZpdHk6IC0xLjIsXHJcblxyXG4gICAgICAgICAgICAvKipcclxuICAgICAgICAgICAgICogVGhldGEgY29lZmZpY2llbnQgZnJvbSBCYXJuZXMgSHV0IHNpbXVsYXRpb24uIFJhbmdlZCBiZXR3ZWVuICgwLCAxKS5cclxuICAgICAgICAgICAgICogVGhlIGNsb3NlciBpdCdzIHRvIDEgdGhlIG1vcmUgbm9kZXMgYWxnb3JpdGhtIHdpbGwgaGF2ZSB0byBnbyB0aHJvdWdoLlxyXG4gICAgICAgICAgICAgKiBTZXR0aW5nIGl0IHRvIG9uZSBtYWtlcyBCYXJuZXMgSHV0IHNpbXVsYXRpb24gbm8gZGlmZmVyZW50IGZyb21cclxuICAgICAgICAgICAgICogYnJ1dGUtZm9yY2UgZm9yY2VzIGNhbGN1bGF0aW9uIChlYWNoIG5vZGUgaXMgY29uc2lkZXJlZCkuXHJcbiAgICAgICAgICAgICAqL1xyXG4gICAgICAgICAgICB0aGV0YTogMC44LFxyXG5cclxuICAgICAgICAgICAgLyoqXHJcbiAgICAgICAgICAgICAqIERyYWcgZm9yY2UgY29lZmZpY2llbnQuIFVzZWQgdG8gc2xvdyBkb3duIHN5c3RlbSwgdGh1cyBzaG91bGQgYmUgbGVzcyB0aGFuIDEuXHJcbiAgICAgICAgICAgICAqIFRoZSBjbG9zZXIgaXQgaXMgdG8gMCB0aGUgbGVzcyB0aWdodCBzeXN0ZW0gd2lsbCBiZS5cclxuICAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIGRyYWdDb2VmZjogMC4wMixcclxuXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAgKiBEZWZhdWx0IHRpbWUgc3RlcCAoZHQpIGZvciBmb3JjZXMgaW50ZWdyYXRpb25cclxuICAgICAgICAgICAgICovXHJcbiAgICAgICAgICAgIHRpbWVTdGVwOiAyMCxcclxuICAgICAgICAgICAgaXRlcmF0aW9uczogMTAwMDAsXHJcbiAgICAgICAgICAgIGZpdDogdHJ1ZSxcclxuXHJcbiAgICAgICAgICAgIC8qKlxyXG4gICAgICAgICAgICAgKiBNYXhpbXVtIG1vdmVtZW50IG9mIHRoZSBzeXN0ZW0gd2hpY2ggY2FuIGJlIGNvbnNpZGVyZWQgYXMgc3RhYmlsaXplZFxyXG4gICAgICAgICAgICAgKi9cclxuICAgICAgICAgICAgc3RhYmxlVGhyZXNob2xkOiAwLjAwMDAwOVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaXRlcmF0aW9uczogMTAwMDAsXHJcbiAgICAgICAgcmVmcmVzaEludGVydmFsOiAxNiwgLy8gaW4gbXNcclxuICAgICAgICByZWZyZXNoSXRlcmF0aW9uczogMTAsIC8vIGl0ZXJhdGlvbnMgdW50aWwgdGhyZWFkIHNlbmRzIGFuIHVwZGF0ZVxyXG4gICAgICAgIHN0YWJsZVRocmVzaG9sZDogMixcclxuICAgICAgICBhbmltYXRlOiB0cnVlLFxyXG4gICAgICAgIGZpdDogdHJ1ZVxyXG4gICAgfTtcclxuXHJcbiAgICB2YXIgZXh0ZW5kID0gT2JqZWN0LmFzc2lnbiB8fCBmdW5jdGlvbiAodGd0KSB7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIG9iaiA9IGFyZ3VtZW50c1tpXTtcclxuXHJcbiAgICAgICAgICAgIGZvciAodmFyIGsgaW4gb2JqKSB7XHJcbiAgICAgICAgICAgICAgICB0Z3Rba10gPSBvYmpba107XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIHRndDtcclxuICAgIH07XHJcblxyXG4gICAgZnVuY3Rpb24gTGF5b3V0KG9wdGlvbnMpIHtcclxuICAgICAgICB0aGlzLm9wdGlvbnMgPSBleHRlbmQoe30sIGRlZmF1bHRzLCBvcHRpb25zKTtcclxuICAgICAgICB0aGlzLmxheW91dE9wdGlvbnMgPSBleHRlbmQoe30sIGRlZmF1bHRzLCBvcHRpb25zKTtcclxuICAgICAgICBkZWxldGUgdGhpcy5sYXlvdXRPcHRpb25zLmN5O1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLmxheW91dE9wdGlvbnMuZWxlcztcclxuICAgIH1cclxuXHJcbiAgICBMYXlvdXQucHJvdG90eXBlLmwgPSBObGF5b3V0O1xyXG4gICAgTGF5b3V0LnByb3RvdHlwZS5nID0gR3JhcGg7XHJcblxyXG4gICAgTGF5b3V0LnByb3RvdHlwZS5ydW4gPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgdmFyIGxheW91dCA9IHRoaXM7XHJcbiAgICAgICAgbGF5b3V0LnRyaWdnZXIoeyB0eXBlOiAnbGF5b3V0c3RhcnQnLCBsYXlvdXQ6IGxheW91dCB9KTtcclxuICAgICAgICB2YXIgb3B0aW9ucyA9IHRoaXMub3B0aW9ucztcclxuICAgICAgICB2YXIgbGF5b3V0T3B0aW9ucyA9IHRoaXMubGF5b3V0T3B0aW9ucztcclxuICAgICAgICB2YXIgdGhhdCA9IHRoaXM7XHJcbiAgICAgICAgdmFyIGdyYXBoID0gdGhhdC5nKCk7XHJcbiAgICAgICAgdmFyIGN5ID0gb3B0aW9ucy5jeTtcclxuICAgICAgICB2YXIgZWxlcyA9IG9wdGlvbnMuZWxlcztcclxuICAgICAgICB2YXIgbm9kZXMgPSBlbGVzLm5vZGVzKCk7XHJcbiAgICAgICAgdmFyIHBhcmVudHMgPSBub2Rlcy5wYXJlbnRzKCk7XHJcblxyXG4gICAgICAgIC8vIEZJTFRFUlxyXG5cclxuICAgICAgICBub2RlcyA9IG5vZGVzLmRpZmZlcmVuY2UocGFyZW50cyk7XHJcblxyXG4gICAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyRm4oZnVuY3Rpb24gKGVsZSkge1xyXG4gICAgICAgICAgICByZXR1cm4gZWxlLmNvbm5lY3RlZEVkZ2VzKCkubGVuZ3RoID4gMFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB2YXIgZWRnZXMgPSBlbGVzLmVkZ2VzKCk7XHJcbiAgICAgICAgdmFyIGVkZ2VzSGFzaCA9IHt9O1xyXG4gICAgICAgIHZhciBMO1xyXG5cclxuXHJcbiAgICAgICAgdmFyIGZpcnN0VXBkYXRlID0gdHJ1ZTtcclxuXHJcbiAgICAgICAgLyogICAgICAgIGlmIChlbGVzLmxlbmd0aCA+IDMwMDApIHtcclxuICAgICAgICAgb3B0aW9ucy5pdGVyYXRpb25zID0gb3B0aW9ucy5pdGVyYXRpb25zIC0gTWF0aC5hYnMob3B0aW9ucy5pdGVyYXRpb25zIC8gMyk7IC8vIHJlZHVjZSBpdGVyYXRpb25zIGZvciBiaWcgZ3JhcGhcclxuICAgICAgICAgfSovXHJcblxyXG4gICAgICAgIHZhciB1cGRhdGUgPSBmdW5jdGlvbiAobm9kZXNKc29uKSB7XHJcbiAgICAgICAgICAgIC8qIGN5LmJhdGNoKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgIG5vZGVzSnNvbi5mb3JFYWNoKGZ1bmN0aW9uKGUsayl7XHJcbiAgICAgICAgICAgICBub2Rlcy4kKCcjJysgZS5kYXRhLmlkKS5wb3NpdGlvbihlLnBvc2l0aW9uKTtcclxuICAgICAgICAgICAgIH0pXHJcblxyXG4gICAgICAgICAgICAgfSk7Ki9cclxuICAgICAgICAgICAgbm9kZXMucG9zaXRpb25zKGZ1bmN0aW9uIChpLCBub2RlKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGkgIT0gJ251bWJlcicpIHtcclxuICAgICAgICAgICAgICAgICAgICB2YXIgdG1wID0gaTtcclxuICAgICAgICAgICAgICAgICAgICBpID0gbm9kZTtcclxuICAgICAgICAgICAgICAgICAgICBub2RlID0gdG1wO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKCFub2RlLmRhdGEoJ2RyYWdnaW5nJykpXHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIEwuZ2V0Tm9kZVBvc2l0aW9uKG5vZGUuaWQoKSlcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAobGF5b3V0T3B0aW9ucy5hc3luYykge1xyXG4gICAgICAgICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5b3V0LnRyaWdnZXIoeyB0eXBlOiAnbGF5b3V0c3RvcCcsIGxheW91dDogbGF5b3V0IH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGxheW91dC50cmlnZ2VyKHsgdHlwZTogJ2xheW91dHJlYWR5JywgbGF5b3V0OiBsYXlvdXQgfSk7XHJcbiAgICAgICAgICAgICAgICB9LCA1MDApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvKiBub2Rlcy5mb3JFYWNoKGZ1bmN0aW9uIChub2RlKSB7XHJcbiAgICAgICAgICAgICBMLmdldE5vZGVQb3NpdGlvbihub2RlLmlkKCkpXHJcbiAgICAgICAgICAgICB9KTsqL1xyXG5cclxuICAgICAgICAgICAgLy8gbWF5YmUgd2UgZml0IGVhY2ggaXRlcmF0aW9uXHJcbiAgICAgICAgICAgIGlmIChsYXlvdXRPcHRpb25zLmZpdCkge1xyXG4gICAgICAgICAgICAgICAgY3kuZml0KGxheW91dE9wdGlvbnMucGFkZGluZyk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlmIChmaXJzdFVwZGF0ZSkge1xyXG4gICAgICAgICAgICAgICAgLy8gaW5kaWNhdGUgdGhlIGluaXRpYWwgcG9zaXRpb25zIGhhdmUgYmVlbiBzZXRcclxuICAgICAgICAgICAgICAgIGxheW91dC50cmlnZ2VyKCdsYXlvdXRyZWFkeScpO1xyXG4gICAgICAgICAgICAgICAgZmlyc3RVcGRhdGUgPSBmYWxzZTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBncmFwaC5vbignY2hhbmdlZCcsIGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgIC8vICBjb25zb2xlLmRpcihlKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgXy5lYWNoKG5vZGVzLCBmdW5jdGlvbiAoZSwgaykge1xyXG4gICAgICAgICAgICBlLm9uKCd0YXBzdGFydCcsIGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgICAgICBlLmN5VGFyZ2V0LmRhdGEoJ2RyYWdnaW5nJywgdHJ1ZSlcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIGUub24oJ3RhcGVuZCcsIGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgICAgICBlLmN5VGFyZ2V0LnJlbW92ZURhdGEoJ2RyYWdnaW5nJyk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBlLm9uKCdwb3NpdGlvbicsICdub2RlW2RyYWdnaW5nXScsIGZ1bmN0aW9uIChlKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoTC5zZXROb2RlUG9zaXRpb24gJiYgZS5jeVRhcmdldC5kYXRhKCdkcmFnZ2luZycpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgTC5zZXROb2RlUG9zaXRpb24oZS5jeVRhcmdldC5kYXRhKCkuaWQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgZ3JhcGguYWRkTm9kZShlLmRhdGEoKS5pZCk7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIF8uZWFjaChlZGdlcywgZnVuY3Rpb24gKGUsIGspIHtcclxuICAgICAgICAgICAgaWYgKCFlZGdlc0hhc2hbZS5kYXRhKCkuc291cmNlICsgJzonICsgZS5kYXRhKCkudGFyZ2V0XSAmJiAhZWRnZXNIYXNoW2UuZGF0YSgpLnRhcmdldCArICc6JyArIGUuZGF0YSgpLnNvdXJjZV0pIHtcclxuICAgICAgICAgICAgICAgIGVkZ2VzSGFzaFtlLmRhdGEoKS5zb3VyY2UgKyAnOicgKyBlLmRhdGEoKS50YXJnZXRdID0gZTtcclxuICAgICAgICAgICAgICAgIGdyYXBoLmFkZExpbmsoZS5kYXRhKCkuc291cmNlLCBlLmRhdGEoKS50YXJnZXQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIEwgPSB0aGF0LmwoZ3JhcGgsIGxheW91dE9wdGlvbnMpO1xyXG5cclxuICAgICAgICBfLmVhY2gobm9kZXMsIGZ1bmN0aW9uIChlLCBrKSB7XHJcbiAgICAgICAgICAgIHZhciBkYXRhID0gZS5kYXRhKCk7XHJcbiAgICAgICAgICAgIC8vdmFyIHBvcyA9IGUucG9zaXRpb24oKTtcclxuICAgICAgICAgICAgaWYgKGRhdGEucGluKSB7XHJcbiAgICAgICAgICAgICAgICBMLnBpbk5vZGUoZGF0YS5pZCwgdHJ1ZSk7XHJcbiAgICAgICAgICAgICAgICBlLnJlbW92ZURhdGEoJ3BpbicpO1xyXG4gICAgICAgICAgICAgICAgZS5kYXRhKCd1bnBpbicsIHRydWUpO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRhdGEudW5waW4pIHtcclxuICAgICAgICAgICAgICAgIEwucGluTm9kZShkYXRhLmlkLCBmYWxzZSk7XHJcbiAgICAgICAgICAgICAgICBlLnJlbW92ZURhdGEoJ3VucGluJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgLy9pZiAocG9zLnggJiYgcG9zLnkpIHtcclxuICAgICAgICAgICAgLy8gIEwuc2V0Tm9kZVBvc2l0aW9uKGRhdGEuaWQsIHBvcyk7XHJcbiAgICAgICAgICAgIC8vfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB2YXIgbGVmdCA9IGxheW91dE9wdGlvbnMuaXRlcmF0aW9ucztcclxuXHJcbiAgICAgICAgdGhpcy5vbignbGF5b3V0c3RvcCcsIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgbGF5b3V0T3B0aW9ucy5pdGVyYXRpb25zID0gMDtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgTC5vbignc3RhYmxlJywgZnVuY3Rpb24gKCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnZ290IFN0YWJsZSBldmVudCcpO1xyXG4gICAgICAgICAgICBsZWZ0ID0gMDtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgaWYgKCFsYXlvdXRPcHRpb25zLmFuaW1hdGUpIHtcclxuICAgICAgICAgICAgbGF5b3V0T3B0aW9ucy5yZWZyZXNoSW50ZXJ2YWwgPSAwO1xyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgdXBkYXRlVGltZW91dDtcclxuICAgICAgICBMLm9uKCdjeWNsZScsIGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgdXBkYXRlKCk7XHJcbiAgICAgICAgICAgIGlmICghbGF5b3V0T3B0aW9ucy5hbmltYXRlKSB7XHJcbiAgICAgICAgICAgICAgICBzdGVwKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gaWYgKGxheW91dE9wdGlvbnMuYXN5bmMpIHtcclxuICAgICAgICAvLyAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgICAgLy8gfVxyXG5cclxuICAgICAgICB2YXIgc3RlcCA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgaWYgKGxheW91dE9wdGlvbnMuYW5pbWF0ZSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGxlZnQgIT0gMCAgLypjb25kaXRpb24gZm9yIHN0b3BwaW5nIGxheW91dCovKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF1cGRhdGVUaW1lb3V0IHx8IGxlZnQgPT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVUaW1lb3V0ID0gc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZWZ0LS07XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvL3VwZGF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBkYXRlVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBMLnN0ZXAoKSA/IGxlZnQgPSAwIDogZmFsc2U7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWxlZnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0ZXAoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vc3RlcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBsYXlvdXRPcHRpb25zLnJlZnJlc2hJbnRlcnZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBsYXlvdXQudHJpZ2dlcih7IHR5cGU6ICdsYXlvdXRzdG9wJywgbGF5b3V0OiBsYXlvdXQgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgbGF5b3V0LnRyaWdnZXIoeyB0eXBlOiAnbGF5b3V0cmVhZHknLCBsYXlvdXQ6IGxheW91dCB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuXHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxheW91dE9wdGlvbnMuaXRlcmF0aW9uczsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgTC5zdGVwKClcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGxheW91dC50cmlnZ2VyKHsgdHlwZTogJ2xheW91dHN0b3AnLCBsYXlvdXQ6IGxheW91dCB9KTtcclxuICAgICAgICAgICAgICAgIGxheW91dC50cmlnZ2VyKHsgdHlwZTogJ2xheW91dHJlYWR5JywgbGF5b3V0OiBsYXlvdXQgfSk7XHJcbiAgICAgICAgICAgICAgICAvL3VwZGF0ZSgpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgIH07XHJcbiAgICAgICAgc3RlcCgpO1xyXG4gICAgICAgIHJldHVybiB0aGlzO1xyXG4gICAgfTtcclxuXHJcbiAgICBMYXlvdXQucHJvdG90eXBlLnN0b3AgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgLy8gVE9ETzogdGhyZWFkIGFjdGlvbnNcclxuICAgICAgICAvLyBjb250aW51b3VzL2FzeW5jaHJvbm91cyBsYXlvdXQgbWF5IHdhbnQgdG8gc2V0IGEgZmxhZyBldGMgdG8gbGV0XHJcbiAgICAgICAgLy8gcnVuKCkga25vdyB0byBzdG9wXHJcblxyXG5cclxuICAgICAgICBpZiAodGhpcy50aHJlYWQpIHtcclxuICAgICAgICAgICAgdGhpcy50aHJlYWQuc3RvcCgpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy50cmlnZ2VyKCdsYXlvdXRzdG9wJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBjaGFpbmluZ1xyXG4gICAgfTtcclxuXHJcbiAgICBMYXlvdXQucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgLy8gY2xlYW4gdXAgaGVyZSBpZiB5b3UgY3JlYXRlIHRocmVhZHMgZXRjXHJcbiAgICAgICAgLy8gVE9ETzogdGhyZWFkIGFjdGlvbnNcclxuXHJcbiAgICAgICAgaWYgKHRoaXMudGhyZWFkKSB7XHJcbiAgICAgICAgICAgIHRoaXMudGhyZWFkLnN0b3AoKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBjaGFpbmluZ1xyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gTGF5b3V0O1xyXG5cclxufTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2V0KGN5dG9zY2FwZSkge1xyXG4gICAgcmV0dXJuIG5ncmFwaChjeXRvc2NhcGUpO1xyXG59O1xyXG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG4oZnVuY3Rpb24oKXtcclxuXHJcbiAgICAvLyByZWdpc3RlcnMgdGhlIGV4dGVuc2lvbiBvbiBhIGN5dG9zY2FwZSBsaWIgcmVmXHJcbiAgICB2YXIgZ2V0TGF5b3V0ID0gcmVxdWlyZSgnLi9pbXBsLmpzJyk7XHJcbiAgICB2YXIgcmVnaXN0ZXIgPSBmdW5jdGlvbiggY3l0b3NjYXBlICl7XHJcbiAgICAgICAgdmFyIExheW91dCA9IGdldExheW91dCggY3l0b3NjYXBlICk7XHJcbiAgICAgICAgY3l0b3NjYXBlKCdsYXlvdXQnLCAnY3l0b3NjYXBlLW5ncmFwaC5mb3JjZWxheW91dCcsIExheW91dCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGlmKCB0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cyApeyAvLyBleHBvc2UgYXMgYSBjb21tb25qcyBtb2R1bGVcclxuICAgICAgICBtb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdGVyO1xyXG4gICAgfVxyXG5cclxuICAgIGlmKCB0eXBlb2YgZGVmaW5lICE9PSAndW5kZWZpbmVkJyAmJiBkZWZpbmUuYW1kICl7IC8vIGV4cG9zZSBhcyBhbiBhbWQvcmVxdWlyZWpzIG1vZHVsZVxyXG4gICAgICAgIGRlZmluZSgnY3l0b3NjYXBlLW5ncmFwaC5mb3JjZWxheW91dCcsIGZ1bmN0aW9uKCl7XHJcbiAgICAgICAgICAgIHJldHVybiByZWdpc3RlcjtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiggdHlwZW9mIGN5dG9zY2FwZSAhPT0gJ3VuZGVmaW5lZCcgKXsgLy8gZXhwb3NlIHRvIGdsb2JhbCBjeXRvc2NhcGUgKGkuZS4gd2luZG93LmN5dG9zY2FwZSlcclxuICAgICAgICByZWdpc3RlciggY3l0b3NjYXBlICk7XHJcbiAgICB9XHJcblxyXG59KSgpOyJdfQ==
