#!/usr/bin/env node

'use strict';

var async         = require('async');
var ipaddrjs      = require('ipaddr.js');
var md5           = require('md5');
var fs            = require('fs');
var child_process = require('child_process');
var http          = require('http');
var express       = require('express');
var socketio      = require('socket.io');

var app = express();
var server = http.createServer(app);
var io = socketio(server);
server.listen(8080);

var is_bogon_v4 = require('./libs/is_bogon_v4.js');
var is_bogon_v6 = require('./libs/is_bogon_v6.js');

var config = require('./config/private.json');
var public_config = require('./config/public.json');
var caps = require('./config/caps.json');

var probes = Object.create(null);

var setstatus = function (probe, status) {
	if (!probes[probe]) {
		return;
	}
	if (probes[probe].status !== status) {
		if (config.logs.status) {
			console.log(new Date(), probe, probes[probe].host, probes[probe].status, '->', status);
		}
		probes[probe].status = status;
	}
};

var hostcheck = function (probe) {
	if (!probes[probe]) {
		return;
	}
	var proc = child_process.spawn('ssh', config.ssh_defaults.concat([
		probes[probe].host,
		'exit 0'
	]));
	proc.stdout.resume();
	proc.stderr.resume();
	proc.once('exit', function (code, signal) {
		setstatus(probe, code === 0);
		setTimeout(function () {
			hostcheck(probe);
		}, 5000);
	});
};

var hostexec = function (probe, command, resock, done) {
	var timeout_time = 30000;
	if (!probes[probe] || !probes[probe].status) {
		return resock.end() + done();
	}	
	var closed = false;
	var timeout = setTimeout(function () {
		closed = true;
		resock.end() + done();
	}, timeout_time);
	var proc = child_process.spawn('ssh', config.ssh_defaults.concat([
		probes[probe].host,
		command
	]));
	var ended = false;
	proc.stdout.on('data', function (chunk) {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		timeout = setTimeout(function () {
			closed = true;
			resock.end() + done();
		}, timeout_time);
		resock.write(chunk);
	});
	proc.stdout.once('end', function () {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		if (!ended) {
			return ended = true;
		}
		resock.end() + done();
	});
	proc.stderr.on('data', function (chunk) {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		timeout = setTimeout(function () {
			closed = true;
			resock.end() + done();
		}, timeout_time);
		resock.write(chunk);
	});
	proc.stderr.once('end', function () {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		if (!ended) {
			return ended = true;
		}
		resock.end() + done();
	});
};

var execqueue = async.queue(function (task, callback) {
	if (task.resock.socket.destroyed) {
		return callback();
	}
	probes[task.probe].queue.push(task, callback);
}, config.queue.global);

require('./config/probes.json').forEach(function (host) {
	var probe = md5([
		host.country,
		host.city,
		host.unlocode,
		host.provider,
		host.asnumber,
		host.host
	].join('\0'));
	host.status = null;
	host.queue = async.queue(function (task, callback) {
		if (task.resock.socket.destroyed) {
			return callback();
		}
		hostexec(task.probe, task.command, task.resock, callback);
	}, config.queue.probe);
	probes[probe] = host;
	hostcheck(probe);	
});

app.get('/config.json', function (req, res) {
	res.status(200);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(public_config));
});

app.get('/probes.json', function (req, res) {
	var probelist = JSON.parse(JSON.stringify(probes));
	Object.keys(probelist).forEach(function (probe) {
		delete probelist[probe].host;
	});
	res.status(200);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(probelist));
});

app.get('/caps.json', function (req, res) {
	res.status(200);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(caps));
});

app.get(/^\/([a-z0-9]{32})\/([a-z]+)\/([0-9a-f:\.]{1,39})$/, function (req, res) {
	var query = {
		probe: req.params[0],
		type: req.params[1],
		target: req.params[2]
	};
	if (
		!query.type ||
		!query.probe ||
		!query.target ||
		typeof query.type !== 'string' ||
		typeof query.probe !== 'string' ||
		typeof query.target !== 'string' ||
		!probes[query.probe] ||
		!probes[query.probe].status ||
		!caps[query.type]
	) {
		res.status(404);
		return res.end('404 Not Found');
	}
	var proto = ipaddrjs.IPv4.isValidFourPartDecimal(query.target) ? 4 : ipaddrjs.IPv6.isValid(query.target) ? 6 : null;
	if (
		!proto ||
		!(
			probes[query.probe].caps[query.type] === true ||
			probes[query.probe].caps[query.type] === Number(proto)
		)
	) {
		res.status(404);
		return res.end('404 Not Found');
	}
	res.status(200);
	res.setHeader('Content-Type', 'text/plain');
	execqueue.push({
		resock: res,
		probe: query.probe,
		command: (caps[query.type]['cmd' + proto] ? caps[query.type]['cmd' + proto] : caps[query.type]['cmd'] ? caps[query.type]['cmd'] : 'echo unsupported').replace(/{{TARGET}}/g, query.target).replace(/{{PROTO}}/g, proto)
	});	
	if (config.logs.requests && config.logs.requests.http) {
		console.log(new Date(), 'enqueue-http', 'remote=' + (config.logs.use_x_forwarded_for ? req.headers['x-forwarded-for'] : req.socket.remoteAddress), 'type=' + query.type, 'probe=' + query.probe, 'target=' + query.target);
	}
});

io.on('connection', function(socket) {
	var disconnected = false;
	var queue = async.queue(function (task, callback) {
		execqueue.push(task, callback);
	}, config.queue.websocket);
	var resock_socket = {
		destroyed: false
	};
	socket.on('disconnect', function () {
		queue.kill();
		disconnected = true;
		resock_socket.destroyed = true;
	});
	socket.on('exec', function (query) {
		if (!query.id || typeof query.id !== 'string') {
			return;
		}
		if (
			!query.type ||
			!query.probe ||
			!query.target ||
			typeof query.type !== 'string' ||
			typeof query.probe !== 'string' ||
			typeof query.target !== 'string' ||
			!probes[query.probe] ||
			!probes[query.probe].status ||
			!caps[query.type]
		) {
			return socket.emit('err', {query: query, id: query.id, data: 404});
		}
		var proto = ipaddrjs.IPv4.isValidFourPartDecimal(query.target) ? 4 : ipaddrjs.IPv6.isValid(query.target) ? 6 : null;
		if (
			!proto ||
			!(
				probes[query.probe].caps[query.type] === true ||
				probes[query.probe].caps[query.type] === Number(proto)
			)
		) {
			return socket.emit('err', {query: query, id: query.id, data: 404});
		}
		var resock = {
			write: function (chunk) {
				if (disconnected) {
					return;
				}
				socket.emit('data', {query: query, id: query.id, data: chunk ? chunk.toString('utf8') : null});
			},
			end: function (chunk) {
				if (disconnected) {
					return;
				}
				socket.emit('end', {query: query, id: query.id, data: chunk ? chunk.toString('utf8') : null});
			},
			socket: resock_socket
		};
		queue.push({
			resock: resock,
			probe: query.probe,
			command: (caps[query.type]['cmd' + proto] ? caps[query.type]['cmd' + proto] : caps[query.type]['cmd'] ? caps[query.type]['cmd'] : 'echo unsupported').replace(/{{TARGET}}/g, query.target).replace(/{{PROTO}}/g, proto)
		});
		if (config.logs.requests && config.logs.requests.websocket) {
			console.log(new Date(), 'enqueue-websocket', 'remote=' + (config.logs.use_x_forwarded_for ? socket.client.request.headers['x-forwarded-for'] : socket.request.connection.remoteAddress), 'type=' + query.type, 'probe=' + query.probe, 'target=' + query.target);
		}
	});
});

app.get('/', function (req, res, next) {
	if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
		res.status(200);
		res.setHeader('Content-Type', 'text/html');
		return res.end('<!DOCTYPE html>\n<html lang="en"><head></head><body></body></html>');
	}
	next();
});

app.use(express.static('static'));
