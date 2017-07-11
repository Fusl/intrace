jQuery(document).ready(function() {
	jQuery('body').html(
		'<a class="github-fork-ribbon" href="//github.com/Fusl/intrace" title="Fork me on GitHub">Fork me on GitHub</a>' +
		'<div class="container">' +
			'<div class="row">' +
				'<div class="col-xs-12">' +
					'<div id="page-header" class="page-header">' +
					'</div>' +
				'</div>' +
			'</div>' +
			'<div class="row row-margin">' +
				'<div class="col-xs-12">' +
					'<form>' +
						'<div class="input-group input-group-lg">' +
							'<input type="text" class="form-control input-lg" id="target" placeholder="IP Address (e.g. ' + [Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256)].join('.') + ', ' + [Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256)].join('.') + ', ...)">' +
							'<span class="input-group-btn">' +
								'<button class="btn btn-primary btn-lg" id="runtest" type="submit">Run Test</button>' +
							'</span>' +
						'</div>' +
					'</form>' +
				'</div>' +
			'</div>' +
			'<div id="caps" class="row row-margin">' +
			'</div>' +
			'<div id="probes" class="row row-margin">' +
			'</div>' +
			'<div id="results" class="row">' +
			'</div>' +
			'<div id="page-footer" class="footer">' +
			'</div>' +
		'</div>'
	);
	jQuery('#target').focus();
	var capsmatch = {};
	var seturlhash = function() {
		var probes = [];
		var caps = [];
		var target = jQuery('#target').val();
		jQuery('input[type=checkbox][data-toggle=probestoggle]:checked').bootstrapToggle(toggleopts).each(function () {
			probes.push(jQuery(this).attr('id').substr(6));
		});
		jQuery('input[type=checkbox][data-toggle=capstoggle]:checked').bootstrapToggle(toggleopts).each(function () {
			caps.push(jQuery(this).attr('id').substr(4));
		});
		location.hash = '#' + (caps.join(',')) + '/' + (probes.join(',')) + '/' + target;
	};
	var geturlhash = function () {
		return parseurlhash(location.hash);
	};
	var parseurlhash = function (hash) {
		var hashdata = {
			caps: [],
			probes: [],
			target: null
		};
		if (hash[0] !== '#') {
			return hashdata;
		}
		hash = hash.substr(1).split('/');
		if (hash.length !== 3) {
			return hashdata;
		}
		hashdata.caps = hash[0].split(',');
		hashdata.probes = hash[1].split(',');
		hashdata.target = hash[2];
		return hashdata;
	};
	var urlhash = geturlhash();
	if (urlhash.target) {
		if (jQuery('#target').val() === '') {
			jQuery('#target').val(urlhash.target);
		}
	} else {
		jQuery.get('/ip', function (clientip) {
			if (jQuery('#target').val() === '') {
				jQuery('#target').val(clientip);
				jQuery('#target').select();
			}
		});
	}
	var progressupdate = function (id) {
		if (!jQuery('#query_' + id + '_progress_bar').length) {
			return;
		}
		var progress = Number(jQuery('#query_' + id + '_progress_bar').data('progress'));
		if (isNaN(progress)) {
			progress = 0;
		}
		progress += (100 - progress) / 100;
		console.log(progress);
		jQuery('#query_' + id + '_progress_bar').data('progress', progress);
		jQuery('#query_' + id + '_progress_bar').css({width: progress + '%'});
		setTimeout(function () {
			progressupdate(id);
		}, 200);
	};
	var datahandler = function (res, end) {
		if (res.data) {
			jQuery('#query_' + res.id).append(res.data.replace(/\r/g, ''));
		}
		if (end) {
			var slimtext = [];
			if (capsmatch[res.query.type] !== false && capsmatch[res.query.type] !== null && capsmatch[res.query.type] !== undefined) {
				if (typeof capsmatch[res.query.type] === 'string') {
					slimtext = jQuery('#query_' + res.id).text().split('\n').map(function(line){return line.trim();}).filter(function(line){return new RegExp(capsmatch[res.query.type]).test(line);});
				} else if (typeof capsmatch[res.query.type] === 'number' && capsmatch[res.query.type] > 0) {
					slimtext = jQuery('#query_' + res.id).text().split('\n').map(function(line){return line.trim();}).filter(function(line){return line!=='';}).reverse().slice(0, capsmatch[res.query.type]);
				}
			}
			jQuery('#query_' + res.id + '_small').text(slimtext.join(' '));
			jQuery('#query_' + res.id + '_progress').remove();
			if (jQuery('#query_' + res.id).text() === '') {
				jQuery('#query_' + res.id).append('Command produced no output');
			}
		} else {
			if (jQuery('#query_' + res.id + '_progress_bar').data('progress') === '') {
				progressupdate(res.id);
			}
			jQuery('#query_' + res.id + '_small').text(jQuery('#query_' + res.id).text().split('\n').map(function(line){return line.trim();}).filter(function(line){return line!=='';}).reverse().slice(0, 1));
		}
	};
	var socket = io();
	socket.on('err', function (res) {
		datahandler({
			id: res.id,
			data: 'Error querying probe'
		}, true);
	});
	socket.on('data', datahandler);
	socket.on('end', function (res) {
		datahandler(res, true);
	});
	var toggleopts = {
		size: 'mini',
		onstyle: 'primary',
		offstyle: 'default',
		style: 'intrace',
		width: 60
	};
	jQuery.getJSON('/config.json', function (config) {
		jQuery('#page-header').html(config.html.header);
		jQuery('#page-footer').html(config.html.footer);
		jQuery('title').text(config.html.title);
	});
	jQuery.getJSON('/probes.json', function (probes) {
		var lastgroup = null;
		var groups = {};
		Object.keys(probes).forEach(function (probe) {
			groups[probes[probe].group] = !groups[probes[probe].group] ? 1 : groups[probes[probe].group] + 1;
		});
		jQuery('#probes').html(Object.keys(probes).sort(function (a, b) {
			return (
				groups[probes[a].group] > groups[probes[b].group] ?  1 :
				groups[probes[a].group] < groups[probes[b].group] ? -1 :
				probes[a].group         > probes[b].group         ?  1 :
				probes[a].group         < probes[b].group         ? -1 :
				probes[a].unlocode      > probes[b].unlocode      ?  1 :
				probes[a].unlocode      < probes[b].unlocode      ? -1 :
				probes[a].provider      > probes[b].provider      ?  1 :
				probes[a].provider      < probes[b].provider      ? -1 :
				0
			);
		}).map(function (probe) {
			var newgroup = false;
			return (
				(lastgroup !== probes[probe].group ? '<div data-group="' + probes[probe].group + '" class="col-xs-12 col-sm-12 col-md-12 col-lg-12 col-xl-12 groupheader"><h3 class="groupheader-toggle">' + (lastgroup = probes[probe].group) + '</h3></div>' : '') +
				'<div class="col-xs-12 col-sm-6 col-md-6 col-lg-4 col-xl-3 cap_probe' + (probes[probe].residential ? ' residential' : '') + '">' +
					'<div class="float_left">' +
						'<img src="/flags/' + probes[probe].unlocode.toLowerCase().replace(/^(..)(...)$/, '$1') + '.png" class="country-toggle"> ' + 
						'<input id="probe_' + probe + '" data-residential="' + probes[probe].residential + '" data-group="' + probes[probe].group + '" data-unlocode="' + probes[probe].unlocode + '" data-country="' + probes[probe].country + '" data-city="' + probes[probe].city + '" data-provider="' + probes[probe].provider + '" data-asnumber="' + probes[probe].asnumber + '" ' + Object.keys(probes[probe].caps).map(function(cap){return 'data-cap'+cap+'="' + probes[probe].caps[cap] + '"';}).join(' ') + ' ' + (!probes[probe].status ? 'disabled ' : '') + 'data-toggle="probestoggle" data-on="' + probes[probe].unlocode.toUpperCase().replace(/^(..)(...)$/, '$1-$2') + '" data-off="' + probes[probe].unlocode.toUpperCase().replace(/^(..)(...)$/, '$1-$2') + '" type="checkbox" class="probe_checkbox"> ' +
						probes[probe].city +
					'</div>' +
					'<div class="float_right">' +
						'&nbsp;<a href="' + probes[probe].providerurl + '" class="glyphicon glyphicon-home providerhome" aria-hidden="true"></a> ' +
						'<a href="#" class="provider-toggle">' + probes[probe].provider + '</a> ' +
						'<a target="_blank" href="https://bgpview.io/asn/' + probes[probe].asnumber + '" class="asn">' + probes[probe].asnumber + '</a> ' +
						'<a href="#" class="provider-toggle"><img src="/providerlogos/' + md5(probes[probe].provider) + '.png" alt="" title="' + probes[probe].provider + '" onerror="this.onerror=null;this.src=\'/providerlogos/d41d8cd98f00b204e9800998ecf8427e.png\';" ></a>' +
					'</div>' +
					'<div class="clear_both"></div>' +
				'</div>'
			);
		}).join(''));
		jQuery('input[type=checkbox][data-toggle=probestoggle]').bootstrapToggle(toggleopts);
		jQuery('.country-toggle').click(function (e) {
			e.preventDefault();
			var country = jQuery(this).parent().children('div').children('input.probe_checkbox').data('country');
			jQuery('input[type=checkbox][data-toggle=probestoggle][data-country="' + country + '"]').bootstrapToggle('on');
		});
		jQuery('.country-toggle').dblclick(function (e) {
			e.preventDefault();
			var country = jQuery(this).parent().children('div').children('input.probe_checkbox').data('country');
			jQuery('input[type=checkbox][data-toggle=probestoggle][data-country!="' + country + '"]').bootstrapToggle('off');
		});
		jQuery('.provider-toggle').click(function (e) {
			e.preventDefault();
			var provider = jQuery(this).parent().parent().children('div').first().children('div').children('input.probe_checkbox').data('provider');
			jQuery('input[type=checkbox][data-toggle=probestoggle][data-provider="' + provider + '"]').bootstrapToggle('on');
		});
		jQuery('.provider-toggle').dblclick(function (e) {
			e.preventDefault();
			var provider = jQuery(this).parent().parent().children('div').first().children('div').children('input.probe_checkbox').data('provider');
			jQuery('input[type=checkbox][data-toggle=probestoggle][data-provider!="' + provider + '"]').bootstrapToggle('off');
		});
		jQuery('.groupheader-toggle').click(function (e) {
			e.preventDefault();
			var group = jQuery(this).parent().data('group');
			jQuery('input[type=checkbox][data-toggle=probestoggle][data-group="' + group + '"]').bootstrapToggle(jQuery('input[type=checkbox][data-toggle=probestoggle][data-group="' + group + '"]:checked').length ? 'off' : 'on');
		});
		if (urlhash.probes) {
			urlhash.probes.forEach(function (probe) {
				jQuery('#probe_' + probe).bootstrapToggle('on');
			});
		}
	});
	jQuery.getJSON('/caps.json', function (caps) {
		jQuery('#caps').html(Object.keys(caps).map(function (cap) {
			capsmatch[cap] = caps[cap].highlight;
			return (
				'<div class="col-xs-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 cap_probe">' +
					'<input id="cap_' + cap + '" data-name="' + caps[cap].name + '" data-toggle="capstoggle" data-on="' + cap + '" data-off="' + cap + '" type="checkbox" class="cap_checkbox"> ' +
					caps[cap].name +
				'</div>'
			);
		}));
		jQuery('input[type=checkbox][data-toggle=capstoggle]').bootstrapToggle(toggleopts);
		if (urlhash.caps) {
			urlhash.caps.forEach(function (cap) {
				jQuery('#cap_' + cap).bootstrapToggle('on');
			});
		}
	});
	jQuery('form').on('submit', function (e) {
		e.preventDefault();
		var target = jQuery('#target').val();
		var probes = [];
		var caps = [];
		jQuery('input[type=checkbox][data-toggle=probestoggle]:checked').bootstrapToggle(toggleopts).each(function () {
			probes.push(jQuery(this).attr('id').substr(6));
		});
		jQuery('input[type=checkbox][data-toggle=capstoggle]:checked').bootstrapToggle(toggleopts).each(function () {
			caps.push(jQuery(this).attr('id').substr(4));
		});
		if (!probes.length) {
			return alert('No probe(s) selected');
		}
		if (!caps.length) {
			return alert('No query type(s) selected');
		}
		var proto = null;
		if (/^\s*((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\s*$/.test(target)) {
			proto = 4;
		} else if (/^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$/.test(target)) {
			proto = 6;
		}
		if (!proto) {
			return alert('Invalid IP address');
		}
		var count = 0;
		probes.forEach(function (probe) {
			caps.forEach(function (cap) {
				if (!(
					'' + jQuery('#probe_' + probe).data('cap' + cap) === 'true' ||
					'' + jQuery('#probe_' + probe).data('cap' + cap) === '' + proto
				)) {
					return;
				}
				var id = Math.random().toString(36).split('.')[1];
				jQuery('#results').prepend(
					'<div class="col-xs-12">' +
						'<div class="panel panel-default">' +
							'<div class="panel-heading">' +
								'<h3 class="panel-title query-header">' + target + ' | ' + jQuery('#cap_' + cap).data('name') + ' from ' + jQuery('#probe_' + probe).data('provider') + ' AS' + jQuery('#probe_' + probe).data('asnumber') + ' in ' + jQuery('#probe_' + probe).data('country') + ', ' + jQuery('#probe_' + probe).data('city') + ' <small id="query_' + id + '_small"></small></h3>' +
							'</div>' +
							'<div class="panel-body">' +
								'<div id="query_' + id + '_progress" class="progress"><div id="query_' + id + '_progress_bar" class="progress-bar progress-bar-striped active" role="progressbar" data-progress=""></div></div>' +
								'<pre>' +
									'<div id="query_' + id + '_container"><code id="query_' + id + '"></code></div>' +
								'</pre>' +
							'</div>' +
						'</div>' +
					'</div>'
				);
				socket.emit('exec', {
					id: id,
					type: cap,
					probe: probe,
					target: target
				});
				count++;
			});
		});
		if (!count) {
			return alert('The selected probes are not capable of doing this kind of query/queries');
		}
		jQuery('#target').blur();
		jQuery('#runtest').blur();
		// jQuery(this)[0].reset();
		jQuery.scrollTo('#results', {duration: 250});
		seturlhash();
	});
});
