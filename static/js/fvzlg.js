jQuery(document).ready(function() {
	jQuery('body').html('<a href="https://github.com/Fusl/intrace"><img style="position: absolute; top: 0; right: 0; border: 0;" src="https://camo.githubusercontent.com/52760788cde945287fbb584134c4cbc2bc36f904/68747470733a2f2f73332e616d617a6f6e6177732e636f6d2f6769746875622f726962626f6e732f666f726b6d655f72696768745f77686974655f6666666666662e706e67" alt="Fork me on GitHub" data-canonical-src="https://s3.amazonaws.com/github/ribbons/forkme_right_white_ffffff.png"></a><div class="container"><div class="row"><div class="col-xs-12"><div id="page-header" class="page-header"></div></div></div><div class="row row-margin"><div class="col-xs-12"><form><div class="input-group input-group-lg"><input type="text" class="form-control input-lg" id="target" placeholder="IP Address (e.g. ' + [Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256)].join('.') + ', ' + [Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256)].join('.') + ', ...)"><span class="input-group-btn"><button class="btn btn-primary btn-lg" id="runtest" type="submit">Run Test</button></span></div></form></div></div><div id="caps" class="row row-margin"></div><div id="probes" class="row row-margin"></div><div id="results" class="row"></div><div id="page-footer" class="footer"></div></div>');
	jQuery('#target').focus();
	capsmatch = {};
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
		} else {
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
	var probes = null;
	var caps = null;
	var toggleopts = {
		size: 'mini',
		onstyle: 'primary',
		offstyle: 'default',
		style: 'fvzlg',
		width: 60
	};
	jQuery.getJSON('/config.json', function (config) {
		jQuery('#page-header').html(config.html.header);
		jQuery('#page-footer').html(config.html.footer);
		jQuery('title').text(config.html.title);
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
				return config.html.columned_probes ? (
					(lastgroup !== null && lastgroup !== probes[probe].group ? '</div>' : '') +
					(lastgroup !== probes[probe].group ? '<div class="col-xs-12 col-sm-6 col-md-6 col-lg-4 col-xl-3"><div data-group="' + probes[probe].group + '"><h3>' + (lastgroup = probes[probe].group) + ' <small><a href="#" class="groupheader-toggle">Toggle all</a></small></h3></div>' : '') +
					'<div style="background-image: url(\'/flags/' + probes[probe].unlocode.toLowerCase().replace(/^(..)(...)$/, '$1') + '.png\');" class="cap_probe countryflag">' +
						'<div style="float: left;">' +
							'<input id="probe_' + probe + '" data-group="' + probes[probe].group + '" data-unlocode="' + probes[probe].unlocode + '" data-country="' + probes[probe].country + '" data-city="' + probes[probe].city + '" data-provider="' + probes[probe].provider + '" data-asnumber="' + probes[probe].asnumber + '" ' + Object.keys(probes[probe].caps).map(function(cap){return 'data-cap'+cap+'="' + probes[probe].caps[cap] + '"';}).join(' ') + ' ' + (!probes[probe].status ? 'disabled ' : Math.floor(Math.random() * Object.keys(probes).length * 0.2) === 0 ? 'checked ' : '') + 'data-toggle="probestoggle" data-on="' + probes[probe].unlocode.toUpperCase().replace(/^(..)(...)$/, '$1-$2') + '" data-off="' + probes[probe].unlocode.toUpperCase().replace(/^(..)(...)$/, '$1-$2') + '" type="checkbox" class="probe_checkbox"> ' +
							probes[probe].city +
						'</div>' +
						'<div style="float: right;">' +
							'&nbsp;(' + probes[probe].provider + ' <a target="_blank" href="https://bgpview.io/asn/' + probes[probe].asnumber + '">AS' + probes[probe].asnumber + '</a>)' +
						'</div>' +
						'<div style="clear: both;"></div>' +
					'</div>'
				) : (
					(lastgroup !== probes[probe].group ? '<div data-group="' + probes[probe].group + '" class="col-xs-12 col-sm-12 col-md-12 col-lg-12 col-xl-12 groupheader"><h3>' + (lastgroup = probes[probe].group) + ' <small><a href="#" class="groupheader-toggle">Toggle all</a></small></h3></div>' : '') +
					'<div style="background-image: url(\'/flags/' + probes[probe].unlocode.toLowerCase().replace(/^(..)(...)$/, '$1') + '.png\');" class="col-xs-12 col-sm-6 col-md-6 col-lg-4 col-xl-3 cap_probe countryflag">' +
						'<div style="float: left;">' +
							'<input id="probe_' + probe + '" data-group="' + probes[probe].group + '" data-unlocode="' + probes[probe].unlocode + '" data-country="' + probes[probe].country + '" data-city="' + probes[probe].city + '" data-provider="' + probes[probe].provider + '" data-asnumber="' + probes[probe].asnumber + '" ' + Object.keys(probes[probe].caps).map(function(cap){return 'data-cap'+cap+'="' + probes[probe].caps[cap] + '"';}).join(' ') + ' ' + (!probes[probe].status ? 'disabled ' : Math.floor(Math.random() * Object.keys(probes).length * 0.2) === 0 ? 'checked ' : '') + 'data-toggle="probestoggle" data-on="' + probes[probe].unlocode.toUpperCase().replace(/^(..)(...)$/, '$1-$2') + '" data-off="' + probes[probe].unlocode.toUpperCase().replace(/^(..)(...)$/, '$1-$2') + '" type="checkbox" class="probe_checkbox"> ' +
							probes[probe].city +
						'</div>' +
						'<div style="float: right;">' +
							'&nbsp;(' + probes[probe].provider + ' <a target="_blank" href="https://bgpview.io/asn/' + probes[probe].asnumber + '">AS' + probes[probe].asnumber + '</a>)' +
						'</div>' +
						'<div style="clear: both;"></div>' +
					'</div>'
				);
			}).join('') + (config.html.columned_probes && lastgroup !== null ? '</div>' : ''));
			jQuery('input[type=checkbox][data-toggle^=probestoggle]').bootstrapToggle(toggleopts);
			jQuery('.groupheader-toggle').click(function (e) {
				e.preventDefault();
				xyz = jQuery(this);
				var group = jQuery(this).parent().parent().parent().data('group');
				jQuery('input[type=checkbox][data-toggle^=probestoggle][data-group="' + group + '"]').bootstrapToggle(jQuery('input[type=checkbox][data-toggle^=probestoggle][data-group="' + group + '"]:checked').length ? 'off' : 'on');
			});
		});
		jQuery.getJSON('/caps.json', function (caps) {
			jQuery('#caps').html(Object.keys(caps).map(function (cap) {
				capsmatch[cap] = caps[cap].highlight;
				return (
					'<div class="col-xs-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 cap_probe">' +
						'<input id="cap_' + cap + '" data-name="' + caps[cap].name + '" ' + (Math.floor(Math.random() * Object.keys(caps).length * 0.5) === 0 ? 'checked ' : '') + 'data-toggle="capstoggle" data-on="' + cap + '" data-off="' + cap + '" type="checkbox" class="cap_checkbox"> ' +
						caps[cap].name +
					'</div>'
				);
			}));
			jQuery('input[type=checkbox][data-toggle^=capstoggle]').bootstrapToggle(toggleopts);
		});
	});
	jQuery('form').on('submit', function (e) {
		e.preventDefault();
		var target = jQuery('#target').val();
		var probes = [];
		var caps = [];
		jQuery('input[type=checkbox][data-toggle^=probestoggle]:checked').bootstrapToggle(toggleopts).each(function () {
			probes.push(jQuery(this).attr('id').substr(6));
		});
		jQuery('input[type=checkbox][data-toggle^=capstoggle]:checked').bootstrapToggle(toggleopts).each(function () {
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
								'<pre>' +
									'<code id="query_' + id + '"></code>' +
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
		jQuery(this)[0].reset();
		jQuery.scrollTo('#results', {duration: 250});
	});
});
