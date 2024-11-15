let debug = null;

let executeSparqlQuery = function (sparqlQueryString, endpointURI ,format = 'JSON') {
    /**Send SPARQL query to endpoint and return result.*/
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
    /**Takes the core of a SPARQL query and completes it (e.g. adds prefixes).*/
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
    /**Takes a URI and formats it according to the prefix map.
    This basically is a fire and forget function, punch in
    full uris, prefixed uris or anything and it will be fine

    1. if uri can be prefixed, prefixes it and returns
    2. checks whether uri is already prefixed and returns
    3. else it puts brackets around the <uri>
    */    
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
    /** Return a set of queries to find relations between two objects.

        Parameters
        ----------
        object1: str
            First object.
        object2: str
            Second object.
        maxDistance: int
            The maximum distance up to which we want to search.
        limit: int
            The maximum number of results per SPARQL query (=LIMIT).
        ignoredObjects: list
            Objects which should not be part of the returned connections between the first and second object.
        ignoredProperties: list
            Properties which should not be part of the returned connections between the first and second object.
        avoidCycles: int
            value which indicates whether we want to suppress cycles,
            0 = no cycle avoidance
            1 = no intermediate object can be object1 or object2
            2 = like 1 + an object can not occur more than once in a connection.

        Returns
        ----------
        A two dimensional array of the form [distance][queries]
        */
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
        /**
        generates all possibilities for the distances

        current
        distance     a     b
        2            1    1
        3            2    1
                     1    2
        4            3    1
                     1    3
                     2    2
        */

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
    /**Return a set of queries to find relations between two objects,
    which are connected via a middle objects.
    dist1 and dist2 give the distance between the first and second object to the middle
    they have ti be greater that 1

    Patterns:
    if toObject is true then:
    PATTERN                                                DIST1    DIST2
    first-->?middle<--second                               1        1
    first-->?of1-->?middle<--second                        2        1
    first-->?middle<--?os1<--second                        1        2
    first-->?of1-->middle<--?os1<--second                  2        2
    first-->?of1-->?of2-->middle<--second                  3        1

    if toObject is false then (reverse arrows)
    first<--?middle-->second

    the naming of the variables is "pf" and "of" because predicate from "f"irst object
    and "ps" and "os" from "s"econd object

    Parameters
    ----------
    first: str
        First object.
    second: str
        Second object.
    dist1: int
        Distance of first object from middle
    dist2: int
        Distance of second object from middle
    toObject: boolean
        reverses the direction of arrows.
    options: list
        All options like ignoredProperties, etc. are passed via this array (needed for filters)

    Returns
    -------
    the SPARQL Query as a String
    */

    let vars = { pred: [], obj: ['?middle'] };
    let fs = 'f';
    let tmpdist = a;
    let twice = 0;
    let coreQuery = '';
    let object = object1;
   /** to keep the code compact I used a loop
    subfunctions were not appropiate since information for filters is collected
    basically the first loop generates $first-pf1->of1-pf2->middle
    while the second generates $second -ps1->os1-pf2->middle
    */

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
   /**Helper function to reverse the order*/

    if (toObject) {
        return `${s} ${p} ${o} .\n`;
    } else {
        return `${o} ${p} ${s} .\n`;
    }
};

let direct = function (object1, object2, distance, options) {
       /**Returns a query for getting a direct connection from object1 to object2.*/

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
    /**     assembles the filter according to the options given and the variables used
    Parameters
    ----------
    vars: dictionary
        {
             "pred": [
               "?pf1"
           ]
             "obj": [
               "?of1"
           ]
       }
*/

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
       /**puts bracket around the (filterterms) and concatenates them with &&*/
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
    /**In some cases paths coming from reconstruct_vars_order are not ordered,
    so they are ordered here

    e.g.
        ['of1', 'pf1', 'of2', 'pf2', 'pf3']
    instead of
        ['pf1', 'of1', 'pf2', 'of2', 'pf3']

    So they have to be reordered

    Parameters
    ----------
    list: list
        the list of objects and relations to be reordered
    left: boolean
        if True, handles left lists, else right lists

    Returns
    -------
    ordered list
    */

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
    /**Reconstruct the correct left and right paths

    e.g.
        ['src', 'of1', 'pf1', 'of2', 'pf2', 'middle', 'pf3', 'ps1', 'dst']
    becomes:
        left: ['src', 'pf1', 'of1', 'pf2', 'of2', 'pf3', 'middle']
        right: ['dst', 'ps1', 'middle']

    Parameters
    ----------
    var_list: list
        the original list of objects and relations as returned by relfinder

    Returns
    -------
    left and right ordered lists
    */

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
    /**If src and dst are connected via a middle object, split the path into a
    left (from src to middle) and right (from dst to middle) path

    Parameters
    ----------
    list: list
        the original list of objects and relations as returned by relfinder

    Returns
    -------
    list of paths connecting scr and dst (either direct path or a left and right
    path through a middle object)
    */

    if (list.includes('middle')) {
        return reconstruct_vars_order(list);
    } else {
        return [list];
    }
};

var compose_triple = function (triple_names, triple_values) {
    /**Creates a triple given the object (of/os) and properties names (pf/ps)
    and their corresponding value.

    e.g.
        ('of1', 'pf2', 'of2')
    becomes:
        ('Immanuel_Kant', 'influencedBy', 'Georg_Wilhelm_Friedrich_Hegel')

    Parameters
    ----------
    triple_names: list
        list of object and property keywords (of/os, pf/ps)
    triple_values: dict
        mapping of keywords to DBpedia uri values

    Returns
    -------
    the triple as s, p, o
    */

    let s = triple_values[triple_names[0]] ? triple_values[triple_names[0]].value : triple_names[0];
    let p = triple_values[triple_names[1]].value;
    let o = triple_values[triple_names[2]] ? triple_values[triple_names[2]].value : triple_names[2];
    return [s, p, o];
};

var parse_triplestore_response = function (src, dst, response) {
    /**Parses the JSON response of the SPARQL query sent to the DBpedia endpoint.

    Parameters
    ----------
    src: str
        name of source entity
    dst: str
        name of destination entity
    response: dict
        JSON response

    Returns
    -------
    the list of paths connecting scr and dst. A path is a list of triples
    */

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
    /**Save paths retrieved by relfinder to a tsv file.

    save format is:
        path_number \t s \t p \t o

    Parameters
    ----------
    paths: list
        list of paths connecting source and destination
    file: str
        destination file
    num: str
        current path number
    ignore: list
        list of properties to ignore. If a path contains at least one of these,
        it is not saved to file
    */


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