#!/usr/bin/env node

'use strict';

process.env.LC_ALL = 'C';
process.env.LANG = 'C';
process.env.LANGUAGE = 'C';

const async         = require('async');
const ipaddrjs      = require('ipaddr.js');
const child_process = require('child_process');
const http          = require('http');
const express       = require('express');
const socketio      = require('socket.io');
const crc32         = require('crc-32');
const bases         = require('bases');
const RateLimiter   = require('express-rate-limit');
const validator     = require('validator');

const app = express();
app.enable('trust proxy', '0.0.0.0/0');
const server = http.createServer(app);
const io = socketio(server);

const is_bogon_v4 = require('./libs/is_bogon_v4.js');
const is_bogon_v6 = require('./libs/is_bogon_v6.js');

const config = require('./config/private.json');
const public_config = require('./config/public.json');
const caps = require('./config/caps.json');

const hash = string => ('000' + bases.toBase64(Math.abs(crc32.str(string)) % 1073741824)).substr(-5).replace(/\+/g, '-').replace(/\//g, '_');

const log = (...args) => console.error.apply(null, [(log.needs_newline ? '\n' : (log.needs_newline = false).toString().substr(0, 0)) + (new Date()).toISOString()].concat(...args));

const cvalidator = {
	object: str => str && typeof str === 'object' && str instanceof Object,
	array:  str => str && typeof str === 'object' && str instanceof Array,
	string: str => str && typeof str === 'string',
	text:   str => str && typeof str === 'string' && str.trim() !== '',
	int:    str =>        typeof str === 'number' && !isNaN(str) && str === Math.round(str),
	uint:   str =>        typeof str === 'number' && !isNaN(str) && str === Math.round(str) && str >= 0,
	bool:   str => str === true || str === false
};
const cvalid = (name, str, type, defaultvar) => {
	if (!cvalidator[type](str)) {
		if (typeof defaultvar === 'undefined') {
			throw new Error('Configuration key ' + name + ' missing or invalid - Type of value is not ' + type);
		}
		return defaultvar;
	}
	return str;
};

cvalid('private.json',                            config,                          'object');
cvalid('private.json->probe_id_hash',             config.probe_id_hash,            'text'  );
cvalid('private.json->ssh_defaults',              config.ssh_defaults,             'object');
cvalid('private.json->queue',                     config.queue,                    'object');
cvalid('private.json->queue->probe',              config.queue.probe,              'uint'  );
cvalid('private.json->queue->websocket',          config.queue.websocket,          'uint'  );
cvalid('private.json->queue->global',             config.queue.global,             'uint'  );
cvalid('private.json->logs',                      config.logs,                     'object');
cvalid('private.json->logs->status',              config.logs.status,              'bool'  );
cvalid('private.json->logs->requests',            config.logs.requests,            'object');
cvalid('private.json->logs->requests->http',      config.logs.requests.http,       'bool'  );
cvalid('private.json->logs->requests->websocket', config.logs.requests.websocket,  'bool'  );
cvalid('private.json->logs->use_x_forwarded_for', config.logs.use_x_forwarded_for, 'bool'  );
cvalid('private.json->http',                      config.http,                     'object');
cvalid('private.json->http->host',                config.http.host,                'string');
cvalid('private.json->http->port',                config.http.port,                'uint'  );
cvalid('private.json->logs->debug',               config.logs.debug,               'bool'  );
cvalid('private.json->limiter',                   config.limiter,                  'object');
cvalid('private.json->limiter->windowMs',         config.limiter.windowMs,         'uint'  );
cvalid('private.json->limiter->max',              config.limiter.max,              'uint'  );
cvalid('private.json->limiter->delayAfter',       config.limiter.delayAfter,       'uint'  );
cvalid('private.json->limiter->delayMs',          config.limiter.delayMs,          'uint'  );
cvalid('private.json->limiter->whitelist',        config.limiter.whitelist,        'array' );
cvalid('private.json->limiter->blacklist',        config.limiter.blacklist,        'array' );

const limiter = new RateLimiter({
	windowMs: config.limiter.windowMs,
	max: config.limiter.max,
	delayAfter: config.limiter.delayAfter,
	delayMs: config.limiter.delayMs,
	skip: (req, res) => {
		return config.limiter.whitelist.indexOf(req.ip.substr(0, 7) === '::ffff:' ? req.ip.substr(7) : req.ip) !== -1;
	},
	message: cvalid('private.json->limiter->message', config.limiter.message, 'string', 'Rate limit exceeded')
});

let shutdown = false;

const probes = Object.create(null);

const setstatus = (probe, status) => {
	if (!probes[probe]) {
		return;
	}
	if (probes[probe].status !== status) {
		if (config.logs.status) {
			log(probe, probes[probe].unlocode, probes[probe].host, probes[probe].status, '->', status);
		}
		probes[probe].status = status;
	}
};

const hostcheck = (probe) => {
	if (!probes[probe]) {
		return;
	}
	const proc = child_process.spawn('ssh', config.ssh_defaults.concat([
		'-p',
		probes[probe].port || 22,
		probes[probe].host,
		'exit 0'
	]));
	proc.stdout.resume();
	proc.stderr.resume();
	proc.once('exit', code => {
		setstatus(probe, code === 0);
		setTimeout(() => {
			hostcheck(probe);
		}, 5000);
	});
	if (config.logs.debug) {
		proc.stdout.on('data', chunk => {
			log('Probe ' + probe + ' stdout:', chunk.toString('utf8'));
		});
		proc.stderr.on('data', chunk => {
			log('Probe ' + probe + ' stderr:', chunk.toString('utf8'));
		});
	}
};

const hostexec = (probe, command, resock, done) => {
	const timeout_time = 30000;
	if (!probes[probe] || !probes[probe].status) {
		return resock.end() + done();
	}
	let closed = false;
	const handleTimeout = () => {
		closed = true;
		resock.end() + done();
	}
	let timeout = setTimeout(handleTimeout, timeout_time);
	const proc = child_process.spawn('ssh', config.ssh_defaults.concat([
		'-p',
		probes[probe].port || 22,
		probes[probe].host,
		command
	]));
	let ended = false;
	proc.stdout.on('data', chunk => {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		timeout = setTimeout(handleTimeout, timeout_time);
		resock.write(chunk);
	});
	proc.stdout.once('end', () => {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		if (!ended) {
			return ended = true;
		}
		resock.end() + done();
	});
	proc.stderr.on('data', chunk => {
		if (closed) {
			return;
		}
		clearTimeout(timeout);
		timeout = setTimeout(handleTimeout, timeout_time);
		resock.write(chunk);
	});
	proc.stderr.once('end', () => {
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

const execqueue = async.queue((task, callback) => {
	if (task.resock.socket.destroyed) {
		return callback();
	}
	if (probes[task.probe].queue.length() >= probes[task.probe].queue.concurrency * 10) {
		return task.resock.status(503) + task.resock.end('503 Service Unavailable') + callback();
	}
	probes[task.probe].queue.push(task, callback);
}, config.queue.global);

require('./config/probes.json').forEach(host => {
	cvalid('probes.json->*->host->country',  host.country,  'text');
	cvalid('probes.json->*->host->city',     host.city,     'text');
	cvalid('probes.json->*->host->unlocode', host.unlocode, 'text');
	cvalid('probes.json->*->host->provider', host.provider, 'text');
	cvalid('probes.json->*->host->asnumber', host.asnumber, 'uint');
	cvalid('probes.json->*->host->host',     host.host,     'text');
	cvalid('probes.json->*->host->group',    host.group,    'text');
	cvalid('probes.json->*->host->caps',     host.caps,     'object');
	const probe = hash([
		config.probe_id_hash,
		host.country,
		host.city,
		host.unlocode,
		host.provider,
		host.asnumber,
		host.host,
		host.group
	].join('\u0000'));
	host.status = null;
	host.queue = async.queue((task, callback) => {
		if (task.resock.socket.destroyed) {
			return callback();
		}
		hostexec(task.probe, task.command, task.resock, callback);
	}, config.queue.probe);
	probes[probe] = host;
	hostcheck(probe);
});

app.use((req, res, next) => {
	const headers = {
		'Content-Security-Policy': [
			"default-src 'none'",
			"script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/",
			"object-src 'none'",
			"style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/ https://fonts.googleapis.com/ http://fonts.googleapis.com/ https://fonts.gstatic.com/ http://fonts.gstatic.com/",
			"media-src 'none'",
			"img-src 'self'",
			"frame-src 'none'",
			"frame-ancestors 'none'",
			"font-src 'self' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/ https://fonts.gstatic.com/ http://fonts.gstatic.com/",
			"connect-src 'self' wss://" + (req.headers.orig_host || req.headers.host || '') + " ws://" + (req.headers.orig_host || req.headers.host || '')
		].join('; '),
		'X-Content-Security-Policy': [
			"default-src 'none'",
			"script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/",
			"object-src 'none'",
			"style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/ https://fonts.googleapis.com/ http://fonts.googleapis.com/ https://fonts.gstatic.com/ http://fonts.gstatic.com/",
			"media-src 'none'",
			"img-src 'self'",
			"frame-src 'none'",
			"frame-ancestors 'none'",
			"font-src 'self' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/ https://fonts.gstatic.com/ http://fonts.gstatic.com/",
			"connect-src 'self' wss://" + (req.headers.orig_host || req.headers.host || '') + " ws://" + (req.headers.orig_host || req.headers.host || '')
		].join('; '),
		'X-WebKit-CSP': [
			"default-src 'none'",
			"script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/",
			"object-src 'none'",
			"style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/ https://fonts.googleapis.com/ http://fonts.googleapis.com/ https://fonts.gstatic.com/ http://fonts.gstatic.com/",
			"media-src 'none'",
			"img-src 'self'",
			"frame-src 'none'",
			"frame-ancestors 'none'",
			"font-src 'self' https://cdnjs.cloudflare.com/ http://cdnjs.cloudflare.com/ https://fonts.gstatic.com/ http://fonts.gstatic.com/",
			"connect-src 'self' wss://" + (req.headers.orig_host || req.headers.host || '') + " ws://" + (req.headers.orig_host || req.headers.host || '')
		].join('; '),
		'Strict-Transport-Security': 'max-age=31536000',
		'X-XSS-Protection': '1; mode=block',
		'X-Frame-Options': 'SAMEORIGIN',
		'Referrer-Policy': 'no-referrer'
	};
	Object.keys(headers).forEach(header_key => {
		res.setHeader(header_key, headers[header_key]);
	});
	return next();
});

app.get('/ip', (req, res) => {
	res.status(200);
	res.setHeader('Content-Type', 'text/plain');
	res.end(req.ip.substr(0, 7) === '::ffff:' ? req.ip.substr(7) : req.ip);
});

app.get('/config.json', (req, res) => {
	res.status(200);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(public_config));
});

app.get('/probes.json', (req, res) => {
	const probelist = Object.create(null);
	Object.keys(probes).forEach(probe => {
		probelist[probe] = {
			country:     probes[probe].country,
			city:        probes[probe].city,
			unlocode:    probes[probe].unlocode,
			provider:    probes[probe].provider,
			asnumber:    probes[probe].asnumber,
			residential: probes[probe].residential,
			group:       probes[probe].group,
			caps:        probes[probe].caps,
			status:      probes[probe].status,
			providerurl: probes[probe].providerurl
		};
	});
	res.status(200);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(probelist));
});

app.get('/caps.json', (req, res) => {
	res.status(200);
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(caps));
});

app.get(/^\/([a-zA-Z0-9_-]{5})\/([a-z]+)\/(.*)$/, limiter, (req, res) => {
	res.setHeader('Content-Type', 'text/plain');
	if (config.limiter.blacklist.indexOf(req.ip.substr(0, 7) === '::ffff:' ? req.ip.substr(7) : req.ip) !== -1) {
		return res.status(403) + cvalid('private.json->limiter->blmessage', config.limiter.blmessage, 'string', 'Access denied');
	}
	const query = {
		probe: req.params[0],
		type: req.params[1],
		target: req.params[2]
	};
	if (
		shutdown ||
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
		return res.status(404) + res.end('404 Not Found');
	}
	const proto = ipaddrjs.IPv4.isValidFourPartDecimal(query.target) ? 4 : ipaddrjs.IPv6.isValid(query.target) ? 6 : validator.isFQDN(query.target, {require_tld: true, allow_underscores: true, allow_trailing_dot: true}) ? 4 : null;
	if (
		!proto ||
		(proto === 4 && is_bogon_v4(query.target) && !validator.isFQDN(query.target, {require_tld: true, allow_underscores: true, allow_trailing_dot: true})) ||
		(proto === 6 && is_bogon_v6(query.target)) ||
		!(
			probes[query.probe].caps[query.type] === true ||
			probes[query.probe].caps[query.type] === Number(proto)
		)
	) {
		return res.status(404) + res.end('404 Not Found');
	}
	if (execqueue.length() >= execqueue.concurrency * 10) {
		return res.status(503) + res.end('503 Service Unavailable');
	}
	execqueue.push({
		resock: res,
		probe: query.probe,
		command: (caps[query.type]['cmd' + proto] || caps[query.type]['cmd'] || 'echo unsupported').replace(/\{\{TARGET\}\}/g, query.target).replace(/\{\{PROTO\}\}/g, proto)
	});
	if (config.logs.requests && config.logs.requests.http && config.limiter.whitelist.indexOf(req.ip.substr(0, 7) === '::ffff:' ? req.ip.substr(7) : req.ip) === -1) {
		log('enqueue-http', 'remote=' + (req.ip.substr(0, 7) === '::ffff:' ? req.ip.substr(7) : req.ip), 'type=' + query.type, 'probe=' + query.probe, 'target=' + query.target);
	}
});

io.on('connection', socket => {
	let disconnected = false;
	const queue = async.queue((task, callback) => {
		execqueue.push(task, callback);
	}, config.queue.websocket);
	const resock_socket = {
		destroyed: false
	};
	socket.on('disconnect', () => {
		queue.kill();
		disconnected = true;
		resock_socket.destroyed = true;
	});
	socket.on('exec', query => {
		if (!query.id || typeof query.id !== 'string') {
			return;
		}
		if (
			shutdown ||
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
		const proto = ipaddrjs.IPv4.isValidFourPartDecimal(query.target) ? 4 : ipaddrjs.IPv6.isValid(query.target) ? 6 : validator.isFQDN(query.target, {require_tld: true, allow_underscores: true, allow_trailing_dot: true}) ? 4 : null;
		if (
			!proto ||
			(proto === 4 && is_bogon_v4(query.target) && !validator.isFQDN(query.target, {require_tld: true, allow_underscores: true, allow_trailing_dot: true})) ||
			(proto === 6 && is_bogon_v6(query.target)) ||
			!(
				probes[query.probe].caps[query.type] === true ||
				probes[query.probe].caps[query.type] === Number(proto)
			)
		) {
			return socket.emit('err', {query: query, id: query.id, data: 404});
		}
		const resock = {
			write: chunk => {
				if (disconnected) {
					return;
				}
				socket.emit('data', {query: query, id: query.id, data: chunk ? chunk.toString('utf8') : null});
			},
			end: chunk => {
				if (disconnected) {
					return;
				}
				socket.emit('end', {query: query, id: query.id, data: chunk ? chunk.toString('utf8') : null});
			},
			status: () => {},
			socket: resock_socket
		};
		if (queue.length() >= queue.concurrency * 10) {
			return resock.end('503 Service Unavailable');
		}
		queue.push({
			resock: resock,
			probe: query.probe,
			command: (caps[query.type]['cmd' + proto] || caps[query.type]['cmd'] || 'echo unsupported').replace(/\{\{TARGET\}\}/g, query.target).replace(/\{\{PROTO\}\}/g, proto)
		});
		if (config.logs.requests && config.logs.requests.websocket) {
			log('enqueue-websocket', 'remote=' + (config.logs.use_x_forwarded_for ? socket.client.request.headers['x-forwarded-for'] : socket.request.connection.remoteAddress), 'type=' + query.type, 'probe=' + query.probe, 'target=' + query.target);
		}
	});
});

app.use(express.static('static'));

if (process.env.HOST || config.http.host && (process.env.HOST || config.http.host) != "*") {
    server.listen(Number(process.env.PORT) || Number(config.http.port) || 3000, process.env.HOST || config.http.host);
} else {
    server.listen(Number(process.env.PORT) || Number(config.http.port) || 3000);
}

process.on('SIGINT', () => {
	if (shutdown || !(execqueue.length() + execqueue.running())) {
		return process.exit(0);
	}
	shutdown = true; // Don't accept any more exec requests over websocket or keep-alive HTTP connections
	server.close(); // Close down the HTTP server
	log('^C pressed - Clean shutdown initiated (waiting for ' + (execqueue.length() + execqueue.running()) + ' tasks to finish) - Press ^C again to exit immediately');
	execqueue.drain = () => {
		process.exit(0);
	};
});
