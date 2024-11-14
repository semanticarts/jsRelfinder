class Relfinder():

    endpointURI = "http://dbpedia.org/sparql"
    # default graphy URI can be empty, but it is usually fast to specify it
    defaultGraphURI = "http://dbpedia.org"
    contentType = "application/sparql-results+json"
    # prefix for all resources (not really needed, but makes queries more readable)
    prefixes = {
        "db": "http://dbpedia.org/resource/",
        "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        "skos": "http://www.w3.org/2004/02/skos/core#"
    }

    def executeSparqlQuery(self, sparqlQueryString, format = "JSON"):
        """Send SPARQL query to endpoint and return result."""
        url = self.endpointURI+"/sparql?query="

        defaultGraphString = "" if len(self.defaultGraphURI)==0 else "&default-graph-uri="+self.defaultGraphURI
        format="&format={}".format(format)
        url = url + encodeURIComponent(sparqlQueryString)+defaultGraphString+format

        # heads = {"Content-Type": self.contentType}
        XHR = __new__ (XMLHttpRequest())
        XHR.open("POST", url, False)
        XHR.setRequestHeader("Content-Type", self.contentType)
        XHR.send()
        contents = JSON.parse(XHR.responseText)

        # contents = requests.post(url, headers=heads)
        return contents

    def completeQuery(self, coreQuery, options, vars):
        """Takes the core of a SPARQL query and completes it (e.g. adds prefixes)."""

        completeQuery = '';
        for k,v in self.prefixes.items():
            completeQuery = completeQuery + 'PREFIX {}: <{}>\n'.format(k,v)
        completeQuery = completeQuery + 'SELECT * WHERE {\n'
        completeQuery = completeQuery + coreQuery + "\n"
        completeQuery = completeQuery + self.generateFilter(options, vars) + "\n"
        completeQuery = completeQuery + '} '
        try:
            completeQuery = completeQuery + 'LIMIT ' + str(options['limit'])
        except KeyError:
            pass
        return completeQuery

    def uri(self, uri):
        """Takes a URI and formats it according to the prefix map.
        This basically is a fire and forget function, punch in
        full uris, prefixed uris or anything and it will be fine

        1. if uri can be prefixed, prefixes it and returns
        2. checks whether uri is already prefixed and returns
        3. else it puts brackets around the <uri>
        """

        for k,v in self.prefixes.items():
            if uri.startswith(v):
                uri = uri.replace(v, k+':')
                return uri

        #prefixes = array_keys(self.prefixes)
        prefixes = self.prefixes.keys()
        check = uri[:uri.index(':')]
        if check in prefixes:
            return uri

        return "<{}>".format(uri)

    def getQueries(self, object1, object2, maxDistance, limit, ignoredObjects, ignoredProperties, avoidCycles):
        """ Return a set of queries to find relations between two objects.

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
        """

        queries = {}
        options = {}
        options['object1'] = object1
        options['object2'] = object2
        options['limit'] = limit
        options['ignoredObjects'] = ignoredObjects
        options['ignoredProperties'] = ignoredProperties
        options['avoidCycles'] = avoidCycles

        for distance in range(1,maxDistance+1):
            queries[distance] = [self.direct(object1, object2, distance, options)]
            queries[distance].append(self.direct(object2, object1, distance, options))

            """
            generates all possibilities for the distances

            current
            distance     a     b
            2            1    1
            3            2    1
                         1    2
            4            3    1
                         1    3
                         2    2
            """

            for a in range(1,maxDistance+1):
                for b in range(1,maxDistance+1):
                    if a+b==distance:
                        queries[distance].append(self.connectedViaAMiddleObject(object1, object2,a, b, True,  options))
                        queries[distance].append(self.connectedViaAMiddleObject(object1, object2,a, b, False,  options))
        return queries

    def connectedViaAMiddleObject(self, first, second, dist1, dist2, toObject, options):
        """Return a set of queries to find relations between two objects,
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
        """

        properties = {}
        vars = {}
        vars['pred'] = []
        vars['obj'] = []
        vars['obj'] =  ['?middle']

        fs = 'f'
        tmpdist = dist1
        twice = 0
        coreQuery = ""
        object = first

        # to keep the code compact I used a loop
        # subfunctions were not appropiate since information for filters is collected
        # basically the first loop generates $first-pf1->of1-pf2->middle
        # while the second generates $second -ps1->os1-pf2->middle
        while twice < 2:

            if tmpdist == 1:
                coreQuery = coreQuery + self.toPattern(self.uri(object), '?p{}1'.format(fs), '?middle', toObject)
                vars['pred'].append('?p{}1'.format(fs))
            else:
                coreQuery = coreQuery + self.toPattern(self.uri(object), '?p{}1'.format(fs), '?o{}1'.format(fs), toObject)
                vars['pred'].append('?p{}1'.format(fs))

                for x in range(1,tmpdist):
                    s = '?o{}{}'.format(fs,x)
                    p = '?p{}{}'.format(fs,x+1)
                    vars['obj'] =  [s]
                    vars['pred'] =  [p]
                    if (x+1)==tmpdist:
                        coreQuery = coreQuery + self.toPattern(s , p , '?middle', toObject)
                    else:
                        coreQuery = coreQuery + self.toPattern(s , p , '?o{}{}'.format(fs,x+1), toObject)

            twice += 1
            fs = 's'
            tmpdist = dist2
            object = second

        return  self.completeQuery(coreQuery, options, vars)

    def toPattern(self, s, p, o, toObject):
        """Helper function to reverse the order"""

        if toObject:
            return '{} {} {} .\n'.format(s,p,o)
        else:
            return '{} {} {} .\n'.format(o,p,s)

    def direct(self, object1, object2, distance, options):
        """Returns a query for getting a direct connection from object1 to object2."""

        vars = {}
        vars['obj'] = []
        vars['pred'] = []
        if distance == 1:
            retval =  '{} ?pf1 {}'.format(self.uri(object1),self.uri(object2))
            vars['pred'].append('?pf1')
            return self.completeQuery(retval,  options, vars)
        else:
            query = '{} ?pf1 ?of1 .\n'.format(self.uri(object1));
            vars['pred'].append('?pf1')
            vars['obj'].append('?of1')
            for i in range(1,distance-1):
                query = query + '?of{} ?pf{} ?of{}.\n'.format(i,i+1,i+1)
                vars['pred'].append('?pf{}'.format(i+1))
                vars['obj'].append('?of{}'.format(i+1))
            query  = query + '?of{} ?pf{} {}'.format(distance-1, distance, self.uri(object2));
            vars['pred'].append('?pf{}'.format(distance))
            return self.completeQuery(query, options, vars)

    def generateFilter(self, options, vars):
        """     assembles the filter according to the options given and the variables used
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
        """

        filterterms = []
        # ignore properties
        for pred in vars['pred']:
            if options['ignoredProperties'] is not None and len(options['ignoredProperties']) > 0:
                for ignored in options['ignoredProperties']:
                    filterterms.append('{} != {} '.format(pred, self.uri(ignored)))

        for obj in vars['obj']:
            # ignore literals
            filterterms.append('!isLiteral({})'.format(obj))
            # ignore objects
            if options['ignoredObjects'] is not None and len(options['ignoredObjects']) > 0:
                for ignored in options['ignoredProperties']:
                    filterterms.append('{} != {} '.format(obj, self.uri(ignored)))

            if options['avoidCycles'] is not None:
                # object variables should not be the same as object1 or object2
                if options['avoidCycles'] > 0:
                    filterterms.append('{} != {} '.format(obj, self.uri(options['object1'])))
                    filterterms.append('{} != {} '.format(obj, self.uri(options['object2'])))
                # object variables should not be the same as any other objectvariables
                if options['avoidCycles'] > 1:
                    for otherObj in vars['obj']:
                        if obj != otherObj:
                            filterterms.append('{} != {} '.format(obj, otherObj))

        return 'FILTER {}. '.format(self.expandTerms(filterterms, '&&'))

    def expandTerms (self, terms, operator = "&&"):
        """puts bracket around the (filterterms) and concatenates them with &&"""

        result=""
        for x in range(len(terms)):
            result = result + "("+str(terms[x])+")"
            if x+1 != len(terms):
                result = result + " "+operator+ " "
            result = result + "\n"
        return "({})".format(result)


def reorder_list(list, left):
    """In some cases paths coming from reconstruct_vars_order are not ordered,
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
    """

    print("reorder:", list)
    list_ord = []
    if left:
        prop = 'pf'
        obj = 'of'
    else:
        prop = 'ps'
        obj = 'os'
    cnt = 1
    list.remove(prop+str(cnt))
    list_ord.append(prop+str(cnt))
    while True:
        if len(list) == 0:
            return list_ord
        else:
            list.remove(obj+str(cnt))
            list_ord.append(obj+str(cnt))
            cnt += 1
            list.remove(prop+str(cnt))
            list_ord.append(prop+str(cnt))

def reconstruct_vars_order(var_list):
    """Reconstruct the correct left and right paths

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
    """
    print("reconstruct_vars_order")
    print(var_list)
    left = []
    right = []
    for elem in var_list[1:-1]:
        if elem[1] == 'f':
            left.append(elem)
        elif elem[1] == 's':
            right.append(elem)
        elif elem == 'middle':
            pass
    left = reorder_list(left, True)
    right = reorder_list(right, False)
    print("left:",left)
    print("right:", right)
    print("\n")
    left.insert(0,var_list[0])
    left.append('middle')
    right.insert(0,'middle')
    right.append(var_list[-1])
    right.reverse()
    return left, right

def split_list(list):
    """If src and dst are connected via a middle object, split the path into a
    left (from src to middle) and right (from dst to middle) path

    Parameters
    ----------
    list: list
        the original list of objects and relations as returned by relfinder

    Returns
    -------
    list of paths connecting scr and dst (either direct path or a left and right
    path through a middle object)
    """

    if 'middle' in list:
        return reconstruct_vars_order(list)
    else:
        return [list]

def compose_triple(triple_names, triple_values):
    """Creates a triple given the object (of/os) and properties names (pf/ps)
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
    """

    try:
        s = triple_values[triple_names[0]]['value']
    except KeyError:
        s = triple_names[0]
    p = triple_values[triple_names[1]]['value']
    try:
        o = triple_values[triple_names[2]]['value']
    except KeyError:
        o = triple_names[2]
    return s, p, o

def parse_dbpedia_response(src, dst, response):
    """Parses the JSON response of the SPARQL query sent to the DBpedia endpoint.

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
    """
    print(response)
    var_list = response['head']['vars']
    var_list.insert(0, src)
    var_list.append(dst)

    path_lists = split_list(var_list)

    paths = []
    for path_values in response['results']['bindings']:
        path = []
        for list in path_lists:
            offset = 0
            offset_limit = len(list) - 3
            triples = []

            while offset <= offset_limit:
                path_step = list[offset:(offset+3)]
                subj, rel, obj = compose_triple(path_step, path_values)
                triples.append((subj, rel, obj))
                offset += 2

            path.extend(triples)
        paths.append(path)

    return paths

def print_paths(paths, num, ignore):
    """Save paths retrieved by relfinder to a tsv file.

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
    """
    for path in paths:           
        #    ttl_file.write([triple)
        ignore_path = False
        path_string = ""
        for triple in path:
            if triple[1].split("/")[-1] in ignore:
                ignore_path = True
            else:
                path_string = path_string + str(num)+"\t"+str(triple[0])+"\t"+str(triple[1])+"\t"+str(triple[2])+"\n"
        if not ignore_path:
            print(path_string)
        num += 1



source = 'Immanuel_Kant'
dest = 'Georg_Wilhelm_Friedrich_Hegel'
out_file = 'relations.csv'
ignored_props = ['22-rdf-syntax-ns#type', 'owl#sameAs', 'DUL.owl#NaturalPerson', 'owl#equivalentClass']
maxDistance = 4

first = 'http://dbpedia.org/resource/{}'.format(source)
second = 'http://dbpedia.org/resource/{}'.format(dest)
rf = Relfinder()

queries = rf.getQueries(first, second, maxDistance, 10, [], ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type','http://www.w3.org/2004/02/skos/core#subject'], True)

path_count = 0
for distance in range (1,maxDistance+1):
    for query in queries[distance]:

        result = rf.executeSparqlQuery(query);
        paths = parse_dbpedia_response(source, dest, result)
        print_paths(paths, path_count, ignored_props)
        path_count += len(paths)