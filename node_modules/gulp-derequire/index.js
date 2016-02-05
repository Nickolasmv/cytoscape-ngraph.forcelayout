/**
 * gulp-derequire
 * 
 * https://github.com/twada/gulp-derequire
 *
 * Copyright (c) 2014-2015 Takuto Wada
 * Licensed under the MIT license.
 *   http://twada.mit-license.org/2014-2015
 */
var through = require('through2'),
    gutil = require('gulp-util'),
    derequire = require('derequire'),
    BufferStreams = require('bufferstreams');

module.exports = function (tokenTo, tokenFrom) {
    'use strict';


    var transform = function (code) {
        return new Buffer(derequire(code, tokenTo, tokenFrom));
    };

    return through.obj(function (file, encoding, callback) {
        encoding = encoding || 'utf8';
        if (file.isNull()) {
            this.push(file);
        } else if (file.isBuffer()) {
            file.contents = transform(file.contents.toString(encoding));
            this.push(file);
        } else if (file.isStream()) {
            file.contents = file.contents.pipe(new BufferStreams(function(err, buf, cb) {
                if(err) {
                    cb(new gutil.PluginError('gulp-derequire', err, {showStack: true}));
                } else {
                    cb(null, transform(buf.toString(encoding)));
                }
            }));
            this.push(file);
        }
        callback();
    });
};
