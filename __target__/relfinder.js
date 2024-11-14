let debug = null;

let executeSparqlQuery = function (sparqlQueryString, endpointURI ,format = 'JSON') {
    console.log(sparqlQueryString);
    let url = endpointURI + '/sparql?query=';
    let defaultGraphString = (defaultGraphURI.length == 0 ? '' : '&default-graph-uri=' + defaultGraphURI);
    format = `&format=${format}`;
    url = ((url + encodeURIComponent(sparqlQueryString)) + defaultGraphString) + format;
    let XHR = new XMLHttpRequest();
    XHR.open('POST', url, false);
    XHR.setRequestHeader('Content-Type', contentType);
    XHR.send();
    let myRes = XHR.responseText ;
    if(debug){console.log(myRes)};
    let contents = JSON.parse(myRes);
    return contents;
};

let completeQuery = function (coreQuery, options, vars) {
    let completeQuery = '';
    for (let [k, v] of Object.entries(prefixesDict)) {
        completeQuery += `PREFIX ${k}: <${v}>\n`;
    }
    completeQuery += 'SELECT * WHERE {\n';
    completeQuery += coreQuery + '\n';
    completeQuery += generateFilter(options, vars) + '\n';
    completeQuery += '} ';
    try {
        completeQuery += 'LIMIT ' + options['limit'].toString();
    } catch (e) {
        if (!(e instanceof TypeError)) {
            throw e;
        }
    }
    return completeQuery;
};

let uri = function (uri) {
    for (let [k, v] of Object.entries(prefixesDict)) {
        if (uri.startsWith(v)) {
            return uri.replace(v, k + ':');
        }
    }
    let prefixes = Object.keys(prefixesDict);
    let check = uri.slice(0, uri.indexOf(':'));
    if (prefixes.includes(check)) {
        return uri;
    }
    return `<${uri}>`;
};

let getQueries = function (object1, object2, maxDistance, limit, ignoredObjects, ignoredProperties, avoidCycles) {
    let queries = {};
    let options = {
        object1: object1,
        object2: object2,
        limit: limit,
        ignoredObjects: ignoredObjects,
        ignoredProperties: ignoredProperties,
        avoidCycles: avoidCycles
    };
    for (let distance = 1; distance < maxDistance + 1; distance++) {
        queries[distance] = [direct(object1, object2, distance, options)];
        queries[distance].push(direct(object2, object1, distance, options));
        for (let a = 1; a < maxDistance + 1; a++) {
            for (let b = 1; b < maxDistance + 1; b++) {
                if (a + b == distance) {
                    queries[distance].push(connectedViaAMiddleObject(object1, object2, a, b, true, options));
                    queries[distance].push(connectedViaAMiddleObject(object1, object2, a, b, false, options));
                }
            }
        }
    }
    return queries;
};

let connectedViaAMiddleObject = function (object1, object2, a, b, toObject, options) {
    let vars = { pred: [], obj: ['?middle'] };
    let fs = 'f';
    let tmpdist = a;
    let twice = 0;
    let coreQuery = '';
    let object = object1;
    while (twice < 2) {
        if (tmpdist == 1) {
            coreQuery += toPattern(uri(object), `?p${fs}1`, '?middle', toObject);
            vars.pred.push(`?p${fs}1`);
        } else {
            coreQuery += toPattern(uri(object), `?p${fs}1`, `?o${fs}1`, toObject);
            vars.pred.push(`?p${fs}1`);
            for (let x = 1; x < tmpdist; x++) {
                let s = `?o${fs}${x}`;
                let p = `?p${fs}${x + 1}`;
                vars.obj.push(s);
                vars.pred.push(p);
                if (x + 1 == tmpdist) {
                    coreQuery += toPattern(s, p, '?middle', toObject);
                } else {
                    coreQuery += toPattern(s, p, `?o${fs}${x + 1}`, toObject);
                }
            }
        }
        twice++;
        fs = 's';
        tmpdist = b;
        object = object2;
    }
    return completeQuery(coreQuery, options, vars);
};

let toPattern = function (s, p, o, toObject) {
    if (toObject) {
        return `${s} ${p} ${o} .\n`;
    } else {
        return `${o} ${p} ${s} .\n`;
    }
};

let direct = function (object1, object2, distance, options) {
    let vars = { obj: [], pred: [] };
    if (distance == 1) {
        let retval = `${uri(object1)} ?pf1 ${uri(object2)}`;
        vars.pred.push('?pf1');
        return completeQuery(retval, options, vars);
    } else {
        let query = `${uri(object1)} ?pf1 ?of1 .\n`;
        vars.pred.push('?pf1');
        vars.obj.push('?of1');
        for (let i = 1; i < distance - 1; i++) {
            query += `?of${i} ?pf${i + 1} ?of${i + 1}.\n`;
            vars.pred.push(`?pf${i + 1}`);
            vars.obj.push(`?of${i + 1}`);
        }
        query += `?of${distance - 1} ?pf${distance} ${uri(object2)}`;
        vars.pred.push(`?pf${distance}`);
        return completeQuery(query, options, vars);
    }
};

let generateFilter = function (options, vars) {
    let filterterms = [];
    for (let pred of vars.pred) {
        if (options.ignoredProperties !== null && Object.keys(options.ignoredProperties).length > 0) {
            for (let ignored of options.ignoredProperties) {
                filterterms.push(`${pred} != ${uri(ignored)} `);
            }
        }
    }
    for (let obj of vars.obj) {
        filterterms.push(`!isLiteral(${obj})`);
        if (options.ignoredObjects !== null && options.ignoredObjects.length > 0) {
            for (let ignored of options.ignoredObjects) {
                filterterms.push(`${obj} != ${uri(ignored)} `);
            }
        }
        if (options.avoidCycles !== null) {
            if (options.avoidCycles > 0) {
                filterterms.push(`${obj} != ${uri(options.object1)} `);
                filterterms.push(`${obj} != ${uri(options.object2)} `);
            }
            if (options.avoidCycles > 1) {
                for (let otherObj of vars.obj) {
                    if (obj != otherObj) {
                        filterterms.push(`${obj} != ${otherObj} `);
                    }
                }
            }
        }
    }
    return `FILTER ${expandTerms(filterterms, '&&')}. `;
};

let expandTerms = function (terms, operator = '&&') {
    let result = '';
    for (let x = 0; x < terms.length; x++) {
        result += `(${terms[x].toString()})`;
        if (x + 1 != terms.length) {
            result += ` ${operator} `;
        }
        result += '\n';
    }
    return `(${result})`;
};

let reorder_list = function (list, left) {
    if(debug){console.log("reorder:", list)};
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
};

var reconstruct_vars_order = function (var_list) {
    if(debug){console.log(var_list)};
    let left = [];
    let right = [];
    for (let elem of var_list.slice(1, -1)) {
        if (elem[1] === 'f') {
            left.push(elem);
        } else if (elem[1] === 's') {
            right.push(elem);
        }
    }
    left = reorder_list(left, true);
    right = reorder_list(right, false);
    if(debug){console.log("left:", left)};
    if(debug){console.log("right:", right)};
    left.unshift(var_list[0]);
    left.push('middle');
    right.unshift('middle');
    right.push(var_list[var_list.length - 1]);
    right.reverse();
    return [left, right];
};

var split_list = function (list) {
    if (list.includes('middle')) {
        return reconstruct_vars_order(list);
    } else {
        return [list];
    }
};

var compose_triple = function (triple_names, triple_values) {
    let s = triple_values[triple_names[0]] ? triple_values[triple_names[0]].value : triple_names[0];
    let p = triple_values[triple_names[1]].value;
    let o = triple_values[triple_names[2]] ? triple_values[triple_names[2]].value : triple_names[2];
    return [s, p, o];
};

var parse_triplestore_response = function (src, dst, response) {
    let var_list = response.head.vars;
    var_list.unshift(src);
    var_list.push(dst);

    let path_lists = split_list(var_list);

    let paths = [];
    for (let path_values of response.results.bindings) {
        let path = [];
        for (let list of path_lists) {
            let offset = 0;
            let offset_limit = list.length - 3;
            let triples = [];

            while (offset <= offset_limit) {
                let path_step = list.slice(offset, offset + 3);
                let [subj, rel, obj] = compose_triple(path_step, path_values);
                triples.push([subj, rel, obj]);
                offset += 2;
            }

            path = path.concat(triples);
            document.getElementById('output_paths').innerText += path ;
        }
        paths.push(path);
    }

    return paths;
};

var print_paths = function (paths, num, ignore, finalPathString = '') {
    for (let path of paths) {
        let ignore_path = false;
        let path_string = "";

        for (let triple of path) {
            if(debug){console.log(triple)};
            if (ignore.includes(triple[1].split("/").pop()) || ignore.includes(triple[1])) {
                ignore_path = true;
          
            } else {
                path_string += `${num}\t${triple[0]}\t${triple[1]}\t${triple[2]}\n`;
            }
        }

        if (!ignore_path) {
            finalPathString += path_string;
        }
        num += 1;
    }
    console.log(finalPathString);
    return finalPathString;
};

// function savePathsToFile(paths, file, num, ignore) {
//     let ttl_file = fs.createWriteStream(file + ".ttl", { flags: 'a' });
//     let f = fs.createWriteStream(file, { flags: 'a', encoding: 'utf-8' });

//     for (let path of paths) {
//         let ignore_path = false;
//         let path_string = "";

//         for (let triple of path) {
//             console.log(triple);
//             if (ignore.includes(triple[1].split("/").pop())) {
//                 ignore_path = true;
//             } else {
//                 path_string += `${num}\t${triple[0]}\t${triple[1]}\t${triple[2]}\n`;
//             }
//         }

//         if (!ignore_path) {
//             f.write(path_string);
//         }
//         num += 1;
//     }

//     ttl_file.end();
//     f.end();
// }