let endpointURI = 'http://dbpedia.org/sparql';
let	defaultGraphURI = 'http://dbpedia.org';
let contentType = 'application/sparql-results+json';
let finalPathString = '';
let prefixesDict = {'db': 'http://dbpedia.org/resource/', 'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'skos': 'http://www.w3.org/2004/02/skos/core#'};

let executeSparqlQuery = function (sparqlQueryString, format) {
		var format = 'JSON';
		var url = endpointURI + '/sparql?query=';
		var defaultGraphString = (len (defaultGraphURI) == 0 ? '' : '&default-graph-uri=' + defaultGraphURI);
		var format = `&format=${format}`;
		var url = ((url + encodeURIComponent (sparqlQueryString)) + defaultGraphString) + format;
		var XHR = new XMLHttpRequest ();
		XHR.open ('POST', url, false);
		XHR.setRequestHeader ('Content-Type', contentType);
		XHR.send ();
		var contents = JSON.parse (XHR.responseText);
		return contents;
	};
let completeQuery = function (coreQuery, options, vars) {
		var completeQuery = '';
		for (var [k, v] of Object.entries(prefixesDict)) {
			var completeQuery = completeQuery + `PREFIX ${k}: <{v}>\n`;
		}
		var completeQuery = completeQuery + 'SELECT * WHERE {\n';
		var completeQuery = (completeQuery + coreQuery) + '\n';
		var completeQuery = (completeQuery + generateFilter (options, vars)) + '\n';
		var completeQuery = completeQuery + '} ';
		try {
			var completeQuery = (completeQuery + 'LIMIT ') + options ['limit'].toString();
		}
		catch (__except0__) {
			if (__except0__ instanceof  TypeError)  {
				// pass;
			}
			else {
				throw __except0__;
			}
		}
		return completeQuery;
	};
let uri = function (uri) {
		for (var [k, v] in prefixesDict) {
			if (uri.startsWith (v)) {
				var uri = uri.replace (v, k + ':');
				return uri;
			}
		}
		var prefixes = Object.keys(prefixesDict);
		var check = uri.slice(0, uri.indexOf (':'));
		if (prefixes.includes(check)) {
			return uri;
		}
		return `<${uri}>`;
	};
let getQueries = function (object1, object2, maxDistance, limit, ignoredObjects, ignoredProperties, avoidCycles) {
		var queries = {};
		var options = {};
		options ['object1'] = object1;
		options ['object2'] = object2;
		options ['limit'] = limit;
		options ['ignoredObjects'] = ignoredObjects;
		options ['ignoredProperties'] = ignoredProperties;
		options ['avoidCycles'] = avoidCycles;
		for (var distance = 1; distance < maxDistance + 1; distance++) {
			queries [distance] = [direct (object1, object2, distance, options)];
			queries [distance].push (direct (object2, object1, distance, options));
			for (var a = 1; a < maxDistance + 1; a++) {
				for (var b = 1; b < maxDistance + 1; b++) {
					if (a + b == distance) {
						queries [distance].push (connectedViaAMiddleObject (object1, object2, a, b, true, options));
						queries [distance].push (connectedViaAMiddleObject (object1, object2, a, b, false, options));
					}
				}
			}
		}
		return queries;
	};
let connectedViaAMiddleObject = function (object1, object2, a, b, toObject, options) {
		var properties = {};
		var vars = {};
		vars ['pred'] = [];
		vars ['obj'] = [];
		vars ['obj'] = ['?middle'];
		var fs = 'f';
		var tmpdist = a;
		var twice = 0;
		var coreQuery = '';
		var object = object1;
		while (twice < 2) {
			if (tmpdist == 1) {
				var coreQuery = coreQuery + toPattern (uri (object), `?p${fs}1`, '?middle', toObject);
				vars ['pred'].push (`?p${fs}1`);
			}
			else {
				var coreQuery = coreQuery + toPattern (uri (object), `?p${fs}1`, `?o${fs}1`, toObject);
				vars ['pred'].push (`?p${fs}1`);
				for (var x = 1; x < tmpdist; x++) {
					var s = `?o${fs}${x}`;
					var p = `?p${fs}${x+1}`;
					vars ['obj'] = [s];
					vars ['pred'] = [p];
					if (x + 1 == tmpdist) {
						var coreQuery = coreQuery + toPattern (s, p, '?middle', toObject);
					}
					else {
						var coreQuery = coreQuery + toPattern (s, p, `?o${fs}${x+1}`, toObject);
					}
				}
			}
			twice++;
			var fs = 's';
			var tmpdist = b;
			var object = object2;
		}
		return completeQuery (coreQuery, options, vars);
	};
let toPattern = function (s, p, o, toObject) {
		if (toObject) {
			return `${s} ${p} ${o} .\n`;
		}
		else {
			return `${o} ${p} ${s} .\n`
			;
		}
	};
let direct = function (object1, object2, distance, options) {
		var vars = {};
		vars ['obj'] = [];
		vars ['pred'] = [];
		if (distance == 1) {
			var retval = `${uri (object1)} ?pf1 ${uri (object2)}`;
			vars ['pred'].push ('?pf1');
			return completeQuery (retval, options, vars);
		}
		else {
			var query = `${uri (object1)} ?pf1 ?of1 .\n`;
			vars ['pred'].push ('?pf1');
			vars ['obj'].push ('?of1');
			for (var i = 1; i < distance - 1; i++) {
				var query = query + `?of${i} ?pf${i=1} ?of${i+1}.\n`;
				vars ['pred'].push (`?pf${i+1}`);
				vars ['obj'].push (`?of${i+1}`);
			}
			var query = query + `?of${distance - 1} ?pf${distance} ${uri (object2)}`;
			vars ['pred'].push (`?pf{distance}`);
			return completeQuery (query, options, vars);
		}
	};
let generateFilter = function (options, vars) {
		var filterterms = [];
		for (var pred of vars ['pred']) {
			if (options ['ignoredProperties'] !== null && Object.keys((options ['ignoredProperties'])).length >0) {
				for (var ignored of options ['ignoredProperties']) {
					filterterms.push (`${pred} != ${uri (ignored)} `);
				}
			}
		}
		for (var obj of vars ['obj']) {
			filterterms.push (`!isLiteral(${obj})`);
			if (options ['ignoredObjects'] !== null && options ['ignoredObjects'].length > 0) {
				for (var ignored of options ['ignoredProperties']) {
					filterterms.push (`${obj} != ${uri (ignored)} `);
				}
			}
			if (options ['avoidCycles'] !== null) {
				if (options ['avoidCycles'] > 0) {
					filterterms.push (`${obj} != ${uri (options ['object1'])} `);
					filterterms.push (`${obj} != ${uri (options ['object2'])} `);
				}
				if (options ['avoidCycles'] > 1) {
					for (var otherObj of vars ['obj']) {
						if (obj != otherObj) {
							filterterms.push (`${obj} != ${otherObj} `);
						}
					}
				}
			}
		}
		return `FILTER ${expandTerms (filterterms, '&&')}. `;
	};
var expandTerms = function (terms, operator) {
		var operator = '&&';
		var result = '';
		for (var x = 0; x < terms.length; x++) {
			var result = ((result + '(') + terms [x].toString()) + ')';
			if (x + 1 != terms.length) {
				var result = ((result + ' ') + operator) + ' ';
			}
			var result = result + '\n';
		}
		return `(${result})`;
	};

var reorder_list = function  (list, left) {
		console.log("reorder:", list);
		let listOrd = [];
		let prop, obj;
		if (left) {
			prop = 'pf';
			obj = 'of';
		} else {
			prop = 'ps';
			obj = 'os';
		}
		let cnt = 1;
		list.splice(list.indexOf(prop + cnt), 1);
		listOrd.push(prop + cnt);
		while (list.length > 0) {
			list.splice(list.indexOf(obj + cnt), 1);
			listOrd.push(obj + cnt);
			cnt += 1;
			list.splice(list.indexOf(prop + cnt), 1);
			listOrd.push(prop + cnt);
		}
		return listOrd;
	}

var reconstruct_vars_order = function (var_list) {
	console.log(varList);
    let left = [];
    let right = [];
    for (let elem of varList.slice(1, -1)) {
        if (elem[1] === 'f') {
            left.push(elem);
        } else if (elem[1] === 's') {
            right.push(elem);
        }
    }
    left = reorderList(left, true);
    right = reorderList(right, false);
    console.log("left:", left);
    console.log("right:", right);
    left.unshift(varList[0]);
    left.push('middle');
    right.unshift('middle');
    right.push(varList[varList.length - 1]);
    right.reverse();
    return [left, right];
};
var split_list = function (list) {
    if (list.includes('middle')) {
        return reconstructVarsOrder(list);
    } else {
        return [list];
    }
};
var compose_triple = function (triple_names, triple_values) {
    let s = tripleValues[tripleNames[0]] ? tripleValues[tripleNames[0]].value : tripleNames[0];
    let p = tripleValues[tripleNames[1]].value;
    let o = tripleValues[tripleNames[2]] ? tripleValues[tripleNames[2]].value : tripleNames[2];
    return [s, p, o];
};
var parse_dbpedia_response = function (src, dst, response) {
    let varList = response.head.vars;
    varList.unshift(src);
    varList.push(dst);

    let pathLists = splitList(varList);

    let paths = [];
    for (let pathValues of response.results.bindings) {
        let path = [];
        for (let list of pathLists) {
            let offset = 0;
            let offsetLimit = list.length - 3;
            let triples = [];

            while (offset <= offsetLimit) {
                let pathStep = list.slice(offset, offset + 3);
                let [subj, rel, obj] = composeTriple(pathStep, pathValues);
                triples.push([subj, rel, obj]);
                offset += 2;
            }

            path = path.concat(triples);
        }
        paths.push(path);
    }

    return paths;
};
var print_paths = function (paths, num, ignore, finalPathString='') {
    for (let path of paths) {
        let ignorePath = false;
        let pathString = "";

        for (let triple of path) {
            console.log(triple);
            if (ignore.includes(triple[1].split("/").pop())) {
                ignorePath = true;
            } else {
                pathString += `${num}\t${triple[0]}\t${triple[1]}\t${triple[2]}\n`;
            }
        }

        if (!ignorePath) {
            finalPathString += pathString;
        }
        num += 1;
    }

	return finalPathString;
};


function savePathsToFile(paths, file, num, ignore) {
    let ttlFile = fs.createWriteStream(file + ".ttl", { flags: 'a' });
    let f = fs.createWriteStream(file, { flags: 'a', encoding: 'utf-8' });

    for (let path of paths) {
        let ignorePath = false;
        let pathString = "";

        for (let triple of path) {
            console.log(triple);
            if (ignore.includes(triple[1].split("/").pop())) {
                ignorePath = true;
            } else {
                pathString += `${num}\t${triple[0]}\t${triple[1]}\t${triple[2]}\n`;
            }
        }

        if (!ignorePath) {
            f.write(pathString);
        }
        num += 1;
    }

    ttlFile.end();
    f.end();
}