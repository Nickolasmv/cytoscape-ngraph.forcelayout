(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(_dereq_,module,exports){
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

},{}],2:[function(_dereq_,module,exports){
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

},{}],3:[function(_dereq_,module,exports){
module.exports = createLayout;
module.exports.simulator = _dereq_('ngraph.physics.simulator.v2');

var eventify = _dereq_('ngraph.events');

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
  listenToEvents();

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
      physicsSimulator.off('stable', onStableChanged);
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

  eventify(api);
  return api;

  function getSpring(fromId, toId) {
    var linkId;
    if (toId === undefined) {
      if (typeof fromId !== 'object') {
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

  function listenToEvents() {
    graph.on('changed', onGraphChanged);
    physicsSimulator.on('stable', onStableChanged);
  }

  function onStableChanged(isStable) {
    api.fire('stable', isStable);
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
    var links = graph.getLinks(nodeId);
    if (!links) return 1;
    return 1 + links.length / 3.0;
  }
}

function noop() { }

},{"ngraph.events":1,"ngraph.physics.simulator":14,"ngraph.physics.simulator.v2":7}],4:[function(_dereq_,module,exports){
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

},{"ngraph.events":1}],5:[function(_dereq_,module,exports){
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

},{}],6:[function(_dereq_,module,exports){
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

},{}],7:[function(_dereq_,module,exports){
/**
 * Manages a simulation of physical forces acting on bodies and springs.
 */
module.exports = physicsSimulator;

function physicsSimulator(settings) {
  var Spring = _dereq_('./lib/spring');
  var expose = _dereq_('ngraph.expose');
  var merge = _dereq_('ngraph.merge');
  var eventify = _dereq_('ngraph.events');

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

  var totalMovement = 0; // how much movement we made on last step
  var lastStable = false; // indicates whether system was stable on last step() call

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
      totalMovement = integrate(bodies, settings.timeStep);

      bounds.update();
      var stableNow = totalMovement < settings.stableThreshold;
      if (lastStable !== stableNow) {
        publicApi.fire('stable', stableNow);
      }

      lastStable = stableNow;

      return stableNow;
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
     * Returns amount of movement performed on last step() call
     */
    getTotalMovement: function () {
      return totalMovement;
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
  eventify(publicApi);

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

},{"./lib/bounds":8,"./lib/createBody":9,"./lib/dragForce":10,"./lib/eulerIntegrator":11,"./lib/spring":12,"./lib/springForce":13,"ngraph.events":1,"ngraph.expose":2,"ngraph.merge":5,"ngraph.quadtreebh":21}],8:[function(_dereq_,module,exports){
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

},{"ngraph.random":25}],9:[function(_dereq_,module,exports){
var physics = _dereq_('ngraph.physics.primitives');

module.exports = function(pos) {
  return new physics.Body(pos);
}

},{"ngraph.physics.primitives":6}],10:[function(_dereq_,module,exports){
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

},{"ngraph.expose":2,"ngraph.merge":5}],11:[function(_dereq_,module,exports){
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

  if (max === 0) {
    return 0;
  }

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

  return (tx * tx + ty * ty)/max;
}

},{}],12:[function(_dereq_,module,exports){
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

},{}],13:[function(_dereq_,module,exports){
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

},{"ngraph.expose":2,"ngraph.merge":5,"ngraph.random":25}],14:[function(_dereq_,module,exports){
/**
 * Manages a simulation of physical forces acting on bodies and springs.
 */
module.exports = physicsSimulator;

function physicsSimulator(settings) {
  var Spring = _dereq_('./lib/spring');
  var expose = _dereq_('ngraph.expose');
  var merge = _dereq_('ngraph.merge');
  var eventify = _dereq_('ngraph.events');

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

  var totalMovement = 0; // how much movement we made on last step
  var lastStable = false; // indicates whether system was stable on last step() call

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
    step: function (final) {
      accumulateForces();
      totalMovement = integrate(bodies, settings.timeStep);


      var stableNow = totalMovement < settings.stableThreshold;
      if (lastStable !== stableNow || final) {
        bounds.update();
        publicApi.fire('stable', stableNow);
      }

      lastStable = stableNow;

      return stableNow;
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
     * Returns amount of movement performed on last step() call
     */
    getTotalMovement: function () {
      return totalMovement;
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
  eventify(publicApi);

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

},{"./lib/bounds":15,"./lib/createBody":16,"./lib/dragForce":17,"./lib/eulerIntegrator":18,"./lib/spring":19,"./lib/springForce":20,"ngraph.events":1,"ngraph.expose":2,"ngraph.merge":5,"ngraph.quadtreebh":21}],15:[function(_dereq_,module,exports){
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

},{"ngraph.random":25}],16:[function(_dereq_,module,exports){
var physics = _dereq_('ngraph.physics.primitives');

module.exports = function(pos) {
  return new physics.Body(pos);
}

},{"ngraph.physics.primitives":6}],17:[function(_dereq_,module,exports){
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

},{"ngraph.expose":2,"ngraph.merge":5}],18:[function(_dereq_,module,exports){
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

  if (max === 0) {
    return 0;
  }

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

  return (tx * tx + ty * ty)/max;
}

},{}],19:[function(_dereq_,module,exports){
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

},{}],20:[function(_dereq_,module,exports){
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

},{"ngraph.expose":2,"ngraph.merge":5,"ngraph.random":25}],21:[function(_dereq_,module,exports){
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

},{"./insertStack":22,"./isSamePosition":23,"./node":24,"ngraph.random":25}],22:[function(_dereq_,module,exports){
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

},{}],23:[function(_dereq_,module,exports){
module.exports = function isSamePosition(point1, point2) {
    var dx = Math.abs(point1.x - point2.x);
    var dy = Math.abs(point1.y - point2.y);

    return (dx < 1e-8 && dy < 1e-8);
};

},{}],24:[function(_dereq_,module,exports){
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

},{}],25:[function(_dereq_,module,exports){
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

},{}],26:[function(_dereq_,module,exports){
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

},{}],27:[function(_dereq_,module,exports){
'use strict';

var Graph = _dereq_('ngraph.graph');
var _ = _dereq_('underscore');
var Nlayout = _dereq_('ngraph.forcelayout.v2');
var Thread;
// registers the extension on a cytoscape lib ref
var ngraph = function (cytoscape) {

    if (!cytoscape) {
        return;
    } // can't register if cytoscape unspecified

    var defaults = {
        springLength: 300,
        springCoeff: 0.0008,
        gravity: -1.2,
        theta: 0.8,
        animate: true,
        dragCoeff: 0.02,
        timeStep: 30,
        stableThreshold: 0.09,
        iterations: 100,
        refreshInterval: 5, // in ms
        refreshIterations: 10, // iterations until thread sends an update
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
    }

    Layout.prototype.l = Nlayout;
    Layout.prototype.g = Graph;

    Layout.prototype.run = function () {
        var layout = this;
        layout.trigger({type: 'layoutstart', layout: layout});


        var options = this.options;
        var that = this;
        var graph = that.g();
        var cy = options.cy;
        var eles = options.eles;
        var nodes = eles.nodes();
        var parents = nodes.parents();
        nodes = nodes.difference(parents);
        var edges = eles.edges();

        var edgesHash={};
        var firstUpdate = true;

/*        if (eles.length > 3000) {
            options.iterations = options.iterations - Math.abs(options.iterations / 3); // reduce iterations for big graph
        }*/

        var update = function () {
            cy.batch(function () {
                nodes.positions(function (i, node) {
                    return L.getNodePosition(node.id())
                });
            });
            // maybe we fit each iteration
            if (options.fit) {
                cy.fit(options.padding);
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
            graph.addNode(e.id)
        });

        _.each(edges, function (e, k) {
            if(!edgesHash[e.data().source+':'+e.data().target] && !edgesHash[e.data().target+':'+e.data().source]){
                edgesHash[e.data().source + ':' + e.data().target] = e;
                graph.addLink(e.data().source, e.data().target);
            }
        });

        var L = that.l(graph, options);

        var left = options.iterations ;

        L.on('stable',function(){
            console.log('got Stable event');
            left = options.iterations ;
        });
        // for (var i = 0; i < (options.iterations || 500); ++i) {

        if (!options.animate) {
            options.refreshInterval = 0;
        }
        var updateTimeout;


        var step = function () {
            if (options.animate) {
                if (left != 0  /*condition for stopping layout*/) {
                    if (!updateTimeout || left == 0) {
                        updateTimeout = setTimeout(function () {
                            L.step();
                            left--;
                            update();
                            updateTimeout = null;
                            step(left==0);
                        }, options.refreshInterval);
                    }
                } else {
                    layout.trigger({type: 'layoutstop', layout: layout});
                    layout.trigger({type: 'layoutready', layout: layout});
                }
            }else{
                for (var i = 0; i < left; ++i) {
                    if(i==Math.abs(left/2)){
                        console.log('Half done!');
                    }
                    L.step(true);
                }
                update();
            }
        };
        step();
        //}


        /*  nodes.layoutPositions(layout,options,function(i,e){
         return L.getNodePosition(e.data().id)
         });*/


        /*    _.each(edges,function(e,k){
         graph.addLink(e.data().source, e.data().target);
         });

         graph.forEachNode(function(node) {
         eles.nodes('#'+node.id() || node.id).position(L.getNodePosition(node.id));
         });*/


        /*          var getRandomPos = function( i, ele ){
         return {
         x: Math.round( Math.random() * 100 ),
         y: Math.round( Math.random() * 100 )
         };
         };*/

        // dicrete/synchronous layouts can just use this helper and all the
        // busywork is handled for you, including std opts:
        // - fit
        // - padding
        // - animate
        // - animationDuration
        // - animationEasing
        // nodes.layoutPositions( layout, options, getRandomPos );

        return this; // or...

        // continuous/asynchronous layouts need to do things manually:
        // (this example uses a thread, but you could use a fabric to get even
        // better performance if your algorithm allows for it)

        /*    var thread = this.thread = cytoscape.thread();
         thread.require( getRandomPos, 'getRandomPos' );

         // to indicate we've started
         layout.trigger('layoutstart');

         // for thread updates
         var firstUpdate = true;
         var id2pos = {};
         var updateTimeout;

         // update node positions
         var update = function(){
         nodes.positions(function( i, node ){
         return id2pos[ node.id() ];
         });

         // maybe we fit each iteration
         if( options.fit ){
         cy.fit( options.padding );
         }

         if( firstUpdate ){
         // indicate the initial positions have been set
         layout.trigger('layoutready');
         firstUpdate = false;
         }
         };

         // update the node positions when notified from the thread but
         // rate limit it a bit (don't want to overwhelm the main/ui thread)
         thread.on('message', function( e ){
         var nodeJsons = e.message;
         nodeJsons.forEach(function( n ){ id2pos[n.data.id] = n.position; });

         if( !updateTimeout ){
         updateTimeout = setTimeout( function(){
         update();
         updateTimeout = null;
         }, options.refreshInterval );
         }
         });

         // we want to keep the json sent to threads slim and fast
         var eleAsJson = function( ele ){
         return {
         data: {
         id: ele.data('id'),
         source: ele.data('source'),
         target: ele.data('target'),
         parent: ele.data('parent')
         },
         group: ele.group(),
         position: ele.position()

         // maybe add calculated data for the layout, like edge length or node mass
         };
         };

         // data to pass to thread
         var pass = {
         eles: eles.map( eleAsJson ),
         refreshIterations: options.refreshIterations
         // maybe some more options that matter to the calculations here ...
         };

         // then we calculate for a while to get the final positions
         thread.pass( pass ).run(function( pass ){
         var getRandomPos = _ref_('getRandomPos');
         var broadcast = _ref_('broadcast');
         var nodeJsons = pass.eles.filter(function(e){ return e.group === 'nodes'; });

         // calculate for a while (you might use the edges here)
         for( var i = 0; i < 100000; i++ ){
         nodeJsons.forEach(function( nodeJson, j ){
         nodeJson.position = getRandomPos( j, nodeJson );
         });

         if( i % pass.refreshIterations === 0 ){ // cheaper to not broadcast all the time
         broadcast( nodeJsons ); // send new positions outside the thread
         }
         }
         }).then(function(){
         // to indicate we've finished
         layout.trigger('layoutstop');
         });

         return this; // chaining*/
    };

    Layout.prototype.stop = function () {
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

        if (this.thread) {
            this.thread.stop();
        }

        return this; // chaining
    };

    return Layout;

};

module.exports = function get(cytoscape) {
    Thread = cytoscape.Thread;

    return ngraph(cytoscape);
};

},{"ngraph.forcelayout.v2":3,"ngraph.graph":4,"underscore":26}],28:[function(_dereq_,module,exports){
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
},{"./impl.js":27}]},{},[28])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLmV2ZW50cy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZXhwb3NlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5mb3JjZWxheW91dC52Mi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGguZ3JhcGgvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLm1lcmdlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yLnYyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnNpbXVsYXRvci52Mi9saWIvYm91bmRzLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnNpbXVsYXRvci52Mi9saWIvY3JlYXRlQm9keS5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IudjIvbGliL2RyYWdGb3JjZS5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IudjIvbGliL2V1bGVySW50ZWdyYXRvci5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IudjIvbGliL3NwcmluZy5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IudjIvbGliL3NwcmluZ0ZvcmNlLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5waHlzaWNzLnNpbXVsYXRvci9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IvbGliL2JvdW5kcy5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IvbGliL2NyZWF0ZUJvZHkuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9kcmFnRm9yY2UuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9ldWxlckludGVncmF0b3IuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9zcHJpbmcuanMiLCJub2RlX21vZHVsZXMvbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yL2xpYi9zcHJpbmdGb3JjZS5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9pbnNlcnRTdGFjay5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9pc1NhbWVQb3NpdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9uZ3JhcGgucXVhZHRyZWViaC9ub2RlLmpzIiwibm9kZV9tb2R1bGVzL25ncmFwaC5yYW5kb20vaW5kZXguanMiLCJub2RlX21vZHVsZXMvdW5kZXJzY29yZS91bmRlcnNjb3JlLmpzIiwic3JjL2ltcGwuanMiLCJzcmMvaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDelRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDamtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDclJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNWdEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25UQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihzdWJqZWN0KSB7XG4gIHZhbGlkYXRlU3ViamVjdChzdWJqZWN0KTtcblxuICB2YXIgZXZlbnRzU3RvcmFnZSA9IGNyZWF0ZUV2ZW50c1N0b3JhZ2Uoc3ViamVjdCk7XG4gIHN1YmplY3Qub24gPSBldmVudHNTdG9yYWdlLm9uO1xuICBzdWJqZWN0Lm9mZiA9IGV2ZW50c1N0b3JhZ2Uub2ZmO1xuICBzdWJqZWN0LmZpcmUgPSBldmVudHNTdG9yYWdlLmZpcmU7XG4gIHJldHVybiBzdWJqZWN0O1xufTtcblxuZnVuY3Rpb24gY3JlYXRlRXZlbnRzU3RvcmFnZShzdWJqZWN0KSB7XG4gIC8vIFN0b3JlIGFsbCBldmVudCBsaXN0ZW5lcnMgdG8gdGhpcyBoYXNoLiBLZXkgaXMgZXZlbnQgbmFtZSwgdmFsdWUgaXMgYXJyYXlcbiAgLy8gb2YgY2FsbGJhY2sgcmVjb3Jkcy5cbiAgLy9cbiAgLy8gQSBjYWxsYmFjayByZWNvcmQgY29uc2lzdHMgb2YgY2FsbGJhY2sgZnVuY3Rpb24gYW5kIGl0cyBvcHRpb25hbCBjb250ZXh0OlxuICAvLyB7ICdldmVudE5hbWUnID0+IFt7Y2FsbGJhY2s6IGZ1bmN0aW9uLCBjdHg6IG9iamVjdH1dIH1cbiAgdmFyIHJlZ2lzdGVyZWRFdmVudHMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gIHJldHVybiB7XG4gICAgb246IGZ1bmN0aW9uIChldmVudE5hbWUsIGNhbGxiYWNrLCBjdHgpIHtcbiAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdjYWxsYmFjayBpcyBleHBlY3RlZCB0byBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgICB9XG4gICAgICB2YXIgaGFuZGxlcnMgPSByZWdpc3RlcmVkRXZlbnRzW2V2ZW50TmFtZV07XG4gICAgICBpZiAoIWhhbmRsZXJzKSB7XG4gICAgICAgIGhhbmRsZXJzID0gcmVnaXN0ZXJlZEV2ZW50c1tldmVudE5hbWVdID0gW107XG4gICAgICB9XG4gICAgICBoYW5kbGVycy5wdXNoKHtjYWxsYmFjazogY2FsbGJhY2ssIGN0eDogY3R4fSk7XG5cbiAgICAgIHJldHVybiBzdWJqZWN0O1xuICAgIH0sXG5cbiAgICBvZmY6IGZ1bmN0aW9uIChldmVudE5hbWUsIGNhbGxiYWNrKSB7XG4gICAgICB2YXIgd2FudFRvUmVtb3ZlQWxsID0gKHR5cGVvZiBldmVudE5hbWUgPT09ICd1bmRlZmluZWQnKTtcbiAgICAgIGlmICh3YW50VG9SZW1vdmVBbGwpIHtcbiAgICAgICAgLy8gS2lsbGluZyBvbGQgZXZlbnRzIHN0b3JhZ2Ugc2hvdWxkIGJlIGVub3VnaCBpbiB0aGlzIGNhc2U6XG4gICAgICAgIHJlZ2lzdGVyZWRFdmVudHMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgICAgICByZXR1cm4gc3ViamVjdDtcbiAgICAgIH1cblxuICAgICAgaWYgKHJlZ2lzdGVyZWRFdmVudHNbZXZlbnROYW1lXSkge1xuICAgICAgICB2YXIgZGVsZXRlQWxsQ2FsbGJhY2tzRm9yRXZlbnQgPSAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKTtcbiAgICAgICAgaWYgKGRlbGV0ZUFsbENhbGxiYWNrc0ZvckV2ZW50KSB7XG4gICAgICAgICAgZGVsZXRlIHJlZ2lzdGVyZWRFdmVudHNbZXZlbnROYW1lXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgY2FsbGJhY2tzID0gcmVnaXN0ZXJlZEV2ZW50c1tldmVudE5hbWVdO1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgICBpZiAoY2FsbGJhY2tzW2ldLmNhbGxiYWNrID09PSBjYWxsYmFjaykge1xuICAgICAgICAgICAgICBjYWxsYmFja3Muc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gc3ViamVjdDtcbiAgICB9LFxuXG4gICAgZmlyZTogZnVuY3Rpb24gKGV2ZW50TmFtZSkge1xuICAgICAgdmFyIGNhbGxiYWNrcyA9IHJlZ2lzdGVyZWRFdmVudHNbZXZlbnROYW1lXTtcbiAgICAgIGlmICghY2FsbGJhY2tzKSB7XG4gICAgICAgIHJldHVybiBzdWJqZWN0O1xuICAgICAgfVxuXG4gICAgICB2YXIgZmlyZUFyZ3VtZW50cztcbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmaXJlQXJndW1lbnRzID0gQXJyYXkucHJvdG90eXBlLnNwbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgICB9XG4gICAgICBmb3IodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgIHZhciBjYWxsYmFja0luZm8gPSBjYWxsYmFja3NbaV07XG4gICAgICAgIGNhbGxiYWNrSW5mby5jYWxsYmFjay5hcHBseShjYWxsYmFja0luZm8uY3R4LCBmaXJlQXJndW1lbnRzKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHN1YmplY3Q7XG4gICAgfVxuICB9O1xufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZVN1YmplY3Qoc3ViamVjdCkge1xuICBpZiAoIXN1YmplY3QpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0V2ZW50aWZ5IGNhbm5vdCB1c2UgZmFsc3kgb2JqZWN0IGFzIGV2ZW50cyBzdWJqZWN0Jyk7XG4gIH1cbiAgdmFyIHJlc2VydmVkV29yZHMgPSBbJ29uJywgJ2ZpcmUnLCAnb2ZmJ107XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmVzZXJ2ZWRXb3Jkcy5sZW5ndGg7ICsraSkge1xuICAgIGlmIChzdWJqZWN0Lmhhc093blByb3BlcnR5KHJlc2VydmVkV29yZHNbaV0pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTdWJqZWN0IGNhbm5vdCBiZSBldmVudGlmaWVkLCBzaW5jZSBpdCBhbHJlYWR5IGhhcyBwcm9wZXJ0eSAnXCIgKyByZXNlcnZlZFdvcmRzW2ldICsgXCInXCIpO1xuICAgIH1cbiAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBleHBvc2VQcm9wZXJ0aWVzO1xuXG4vKipcbiAqIEF1Z21lbnRzIGB0YXJnZXRgIG9iamVjdCB3aXRoIGdldHRlci9zZXR0ZXIgZnVuY3Rpb25zLCB3aGljaCBtb2RpZnkgc2V0dGluZ3NcbiAqXG4gKiBAZXhhbXBsZVxuICogIHZhciB0YXJnZXQgPSB7fTtcbiAqICBleHBvc2VQcm9wZXJ0aWVzKHsgYWdlOiA0Mn0sIHRhcmdldCk7XG4gKiAgdGFyZ2V0LmFnZSgpOyAvLyByZXR1cm5zIDQyXG4gKiAgdGFyZ2V0LmFnZSgyNCk7IC8vIG1ha2UgYWdlIDI0O1xuICpcbiAqICB2YXIgZmlsdGVyZWRUYXJnZXQgPSB7fTtcbiAqICBleHBvc2VQcm9wZXJ0aWVzKHsgYWdlOiA0MiwgbmFtZTogJ0pvaG4nfSwgZmlsdGVyZWRUYXJnZXQsIFsnbmFtZSddKTtcbiAqICBmaWx0ZXJlZFRhcmdldC5uYW1lKCk7IC8vIHJldHVybnMgJ0pvaG4nXG4gKiAgZmlsdGVyZWRUYXJnZXQuYWdlID09PSB1bmRlZmluZWQ7IC8vIHRydWVcbiAqL1xuZnVuY3Rpb24gZXhwb3NlUHJvcGVydGllcyhzZXR0aW5ncywgdGFyZ2V0LCBmaWx0ZXIpIHtcbiAgdmFyIG5lZWRzRmlsdGVyID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGZpbHRlcikgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gIGlmIChuZWVkc0ZpbHRlcikge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlsdGVyLmxlbmd0aDsgKytpKSB7XG4gICAgICBhdWdtZW50KHNldHRpbmdzLCB0YXJnZXQsIGZpbHRlcltpXSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGZvciAodmFyIGtleSBpbiBzZXR0aW5ncykge1xuICAgICAgYXVnbWVudChzZXR0aW5ncywgdGFyZ2V0LCBrZXkpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhdWdtZW50KHNvdXJjZSwgdGFyZ2V0LCBrZXkpIHtcbiAgaWYgKHNvdXJjZS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgaWYgKHR5cGVvZiB0YXJnZXRba2V5XSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgLy8gdGhpcyBhY2Nlc3NvciBpcyBhbHJlYWR5IGRlZmluZWQuIElnbm9yZSBpdFxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0YXJnZXRba2V5XSA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgc291cmNlW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgcmV0dXJuIHRhcmdldDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzb3VyY2Vba2V5XTtcbiAgICB9XG4gIH1cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gY3JlYXRlTGF5b3V0O1xyXG5tb2R1bGUuZXhwb3J0cy5zaW11bGF0b3IgPSByZXF1aXJlKCduZ3JhcGgucGh5c2ljcy5zaW11bGF0b3IudjInKTtcclxuXHJcbnZhciBldmVudGlmeSA9IHJlcXVpcmUoJ25ncmFwaC5ldmVudHMnKTtcclxuXHJcbi8qKlxyXG4gKiBDcmVhdGVzIGZvcmNlIGJhc2VkIGxheW91dCBmb3IgYSBnaXZlbiBncmFwaC5cclxuICogQHBhcmFtIHtuZ3JhcGguZ3JhcGh9IGdyYXBoIHdoaWNoIG5lZWRzIHRvIGJlIGxhaWQgb3V0XHJcbiAqIEBwYXJhbSB7b2JqZWN0fSBwaHlzaWNzU2V0dGluZ3MgaWYgeW91IG5lZWQgY3VzdG9tIHNldHRpbmdzXHJcbiAqIGZvciBwaHlzaWNzIHNpbXVsYXRvciB5b3UgY2FuIHBhc3MgeW91ciBvd24gc2V0dGluZ3MgaGVyZS4gSWYgaXQncyBub3QgcGFzc2VkXHJcbiAqIGEgZGVmYXVsdCBvbmUgd2lsbCBiZSBjcmVhdGVkLlxyXG4gKi9cclxuZnVuY3Rpb24gY3JlYXRlTGF5b3V0KGdyYXBoLCBwaHlzaWNzU2V0dGluZ3MpIHtcclxuICBpZiAoIWdyYXBoKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0dyYXBoIHN0cnVjdHVyZSBjYW5ub3QgYmUgdW5kZWZpbmVkJyk7XHJcbiAgfVxyXG5cclxuICB2YXIgY3JlYXRlU2ltdWxhdG9yID0gcmVxdWlyZSgnbmdyYXBoLnBoeXNpY3Muc2ltdWxhdG9yJyk7XHJcbiAgdmFyIHBoeXNpY3NTaW11bGF0b3IgPSBjcmVhdGVTaW11bGF0b3IocGh5c2ljc1NldHRpbmdzKTtcclxuXHJcbiAgdmFyIG5vZGVCb2RpZXMgPSB0eXBlb2YgT2JqZWN0LmNyZWF0ZSA9PT0gJ2Z1bmN0aW9uJyA/IE9iamVjdC5jcmVhdGUobnVsbCkgOiB7fTtcclxuICB2YXIgc3ByaW5ncyA9IHt9O1xyXG5cclxuICB2YXIgc3ByaW5nVHJhbnNmb3JtID0gcGh5c2ljc1NpbXVsYXRvci5zZXR0aW5ncy5zcHJpbmdUcmFuc2Zvcm0gfHwgbm9vcDtcclxuXHJcbiAgLy8gSW5pdGlhbGl6ZSBwaHlzaWNhbCBvYmplY3RzIGFjY29yZGluZyB0byB3aGF0IHdlIGhhdmUgaW4gdGhlIGdyYXBoOlxyXG4gIGluaXRQaHlzaWNzKCk7XHJcbiAgbGlzdGVuVG9FdmVudHMoKTtcclxuXHJcbiAgdmFyIGFwaSA9IHtcclxuICAgIC8qKlxyXG4gICAgICogUGVyZm9ybXMgb25lIHN0ZXAgb2YgaXRlcmF0aXZlIGxheW91dCBhbGdvcml0aG1cclxuICAgICAqL1xyXG4gICAgc3RlcDogZnVuY3Rpb24oKSB7XHJcbiAgICAgIHJldHVybiBwaHlzaWNzU2ltdWxhdG9yLnN0ZXAoKTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBGb3IgYSBnaXZlbiBgbm9kZUlkYCByZXR1cm5zIHBvc2l0aW9uXHJcbiAgICAgKi9cclxuICAgIGdldE5vZGVQb3NpdGlvbjogZnVuY3Rpb24gKG5vZGVJZCkge1xyXG4gICAgICByZXR1cm4gZ2V0SW5pdGlhbGl6ZWRCb2R5KG5vZGVJZCkucG9zO1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldHMgcG9zaXRpb24gb2YgYSBub2RlIHRvIGEgZ2l2ZW4gY29vcmRpbmF0ZXNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBub2RlSWQgbm9kZSBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge251bWJlcn0geCBwb3NpdGlvbiBvZiBhIG5vZGVcclxuICAgICAqIEBwYXJhbSB7bnVtYmVyfSB5IHBvc2l0aW9uIG9mIGEgbm9kZVxyXG4gICAgICogQHBhcmFtIHtudW1iZXI9fSB6IHBvc2l0aW9uIG9mIG5vZGUgKG9ubHkgaWYgYXBwbGljYWJsZSB0byBib2R5KVxyXG4gICAgICovXHJcbiAgICBzZXROb2RlUG9zaXRpb246IGZ1bmN0aW9uIChub2RlSWQpIHtcclxuICAgICAgdmFyIGJvZHkgPSBnZXRJbml0aWFsaXplZEJvZHkobm9kZUlkKTtcclxuICAgICAgYm9keS5zZXRQb3NpdGlvbi5hcHBseShib2R5LCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpKTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBMaW5rIHBvc2l0aW9uIGJ5IGxpbmsgaWRcclxuICAgICAqIEByZXR1cm5zIHtPYmplY3QuZnJvbX0ge3gsIHl9IGNvb3JkaW5hdGVzIG9mIGxpbmsgc3RhcnRcclxuICAgICAqIEByZXR1cm5zIHtPYmplY3QudG99IHt4LCB5fSBjb29yZGluYXRlcyBvZiBsaW5rIGVuZFxyXG4gICAgICovXHJcbiAgICBnZXRMaW5rUG9zaXRpb246IGZ1bmN0aW9uIChsaW5rSWQpIHtcclxuICAgICAgdmFyIHNwcmluZyA9IHNwcmluZ3NbbGlua0lkXTtcclxuICAgICAgaWYgKHNwcmluZykge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBmcm9tOiBzcHJpbmcuZnJvbS5wb3MsXHJcbiAgICAgICAgICB0bzogc3ByaW5nLnRvLnBvc1xyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBhcmVhIHJlcXVpcmVkIHRvIGZpdCBpbiB0aGUgZ3JhcGguIE9iamVjdCBjb250YWluc1xyXG4gICAgICogYHgxYCwgYHkxYCAtIHRvcCBsZWZ0IGNvb3JkaW5hdGVzXHJcbiAgICAgKiBgeDJgLCBgeTJgIC0gYm90dG9tIHJpZ2h0IGNvb3JkaW5hdGVzXHJcbiAgICAgKi9cclxuICAgIGdldEdyYXBoUmVjdDogZnVuY3Rpb24gKCkge1xyXG4gICAgICByZXR1cm4gcGh5c2ljc1NpbXVsYXRvci5nZXRCQm94KCk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qXHJcbiAgICAgKiBSZXF1ZXN0cyBsYXlvdXQgYWxnb3JpdGhtIHRvIHBpbi91bnBpbiBub2RlIHRvIGl0cyBjdXJyZW50IHBvc2l0aW9uXHJcbiAgICAgKiBQaW5uZWQgbm9kZXMgc2hvdWxkIG5vdCBiZSBhZmZlY3RlZCBieSBsYXlvdXQgYWxnb3JpdGhtIGFuZCBhbHdheXNcclxuICAgICAqIHJlbWFpbiBhdCB0aGVpciBwb3NpdGlvblxyXG4gICAgICovXHJcbiAgICBwaW5Ob2RlOiBmdW5jdGlvbiAobm9kZSwgaXNQaW5uZWQpIHtcclxuICAgICAgdmFyIGJvZHkgPSBnZXRJbml0aWFsaXplZEJvZHkobm9kZS5pZCk7XHJcbiAgICAgICBib2R5LmlzUGlubmVkID0gISFpc1Bpbm5lZDtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDaGVja3Mgd2hldGhlciBnaXZlbiBncmFwaCdzIG5vZGUgaXMgY3VycmVudGx5IHBpbm5lZFxyXG4gICAgICovXHJcbiAgICBpc05vZGVQaW5uZWQ6IGZ1bmN0aW9uIChub2RlKSB7XHJcbiAgICAgIHJldHVybiBnZXRJbml0aWFsaXplZEJvZHkobm9kZS5pZCkuaXNQaW5uZWQ7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUmVxdWVzdCB0byByZWxlYXNlIGFsbCByZXNvdXJjZXNcclxuICAgICAqL1xyXG4gICAgZGlzcG9zZTogZnVuY3Rpb24oKSB7XHJcbiAgICAgIGdyYXBoLm9mZignY2hhbmdlZCcsIG9uR3JhcGhDaGFuZ2VkKTtcclxuICAgICAgcGh5c2ljc1NpbXVsYXRvci5vZmYoJ3N0YWJsZScsIG9uU3RhYmxlQ2hhbmdlZCk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0cyBwaHlzaWNhbCBib2R5IGZvciBhIGdpdmVuIG5vZGUgaWQuIElmIG5vZGUgaXMgbm90IGZvdW5kIHVuZGVmaW5lZFxyXG4gICAgICogdmFsdWUgaXMgcmV0dXJuZWQuXHJcbiAgICAgKi9cclxuICAgIGdldEJvZHk6IGdldEJvZHksXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXRzIHNwcmluZyBmb3IgYSBnaXZlbiBlZGdlLlxyXG4gICAgICpcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBsaW5rSWQgbGluayBpZGVudGlmZXIuIElmIHR3byBhcmd1bWVudHMgYXJlIHBhc3NlZCB0aGVuXHJcbiAgICAgKiB0aGlzIGFyZ3VtZW50IGlzIHRyZWF0ZWQgYXMgZm9ybU5vZGVJZFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmc9fSB0b0lkIHdoZW4gZGVmaW5lZCB0aGlzIHBhcmFtZXRlciBkZW5vdGVzIGhlYWQgb2YgdGhlIGxpbmtcclxuICAgICAqIGFuZCBmaXJzdCBhcmd1bWVudCBpcyB0cmF0ZWQgYXMgdGFpbCBvZiB0aGUgbGluayAoZnJvbUlkKVxyXG4gICAgICovXHJcbiAgICBnZXRTcHJpbmc6IGdldFNwcmluZyxcclxuXHJcbiAgICAvKipcclxuICAgICAqIFtSZWFkIG9ubHldIEdldHMgY3VycmVudCBwaHlzaWNzIHNpbXVsYXRvclxyXG4gICAgICovXHJcbiAgICBzaW11bGF0b3I6IHBoeXNpY3NTaW11bGF0b3JcclxuICB9O1xyXG5cclxuICBldmVudGlmeShhcGkpO1xyXG4gIHJldHVybiBhcGk7XHJcblxyXG4gIGZ1bmN0aW9uIGdldFNwcmluZyhmcm9tSWQsIHRvSWQpIHtcclxuICAgIHZhciBsaW5rSWQ7XHJcbiAgICBpZiAodG9JZCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGlmICh0eXBlb2YgZnJvbUlkICE9PSAnb2JqZWN0Jykge1xyXG4gICAgICAgIC8vIGFzc3VtZSBmcm9tSWQgYXMgYSBsaW5rSWQ6XHJcbiAgICAgICAgbGlua0lkID0gZnJvbUlkO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIGFzc3VtZSBmcm9tSWQgdG8gYmUgYSBsaW5rIG9iamVjdDpcclxuICAgICAgICBsaW5rSWQgPSBmcm9tSWQuaWQ7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIC8vIHRvSWQgaXMgZGVmaW5lZCwgc2hvdWxkIGdyYWIgbGluazpcclxuICAgICAgdmFyIGxpbmsgPSBncmFwaC5oYXNMaW5rKGZyb21JZCwgdG9JZCk7XHJcbiAgICAgIGlmICghbGluaykgcmV0dXJuO1xyXG4gICAgICBsaW5rSWQgPSBsaW5rLmlkO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBzcHJpbmdzW2xpbmtJZF07XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBnZXRCb2R5KG5vZGVJZCkge1xyXG4gICAgcmV0dXJuIG5vZGVCb2RpZXNbbm9kZUlkXTtcclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIGxpc3RlblRvRXZlbnRzKCkge1xyXG4gICAgZ3JhcGgub24oJ2NoYW5nZWQnLCBvbkdyYXBoQ2hhbmdlZCk7XHJcbiAgICBwaHlzaWNzU2ltdWxhdG9yLm9uKCdzdGFibGUnLCBvblN0YWJsZUNoYW5nZWQpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25TdGFibGVDaGFuZ2VkKGlzU3RhYmxlKSB7XHJcbiAgICBhcGkuZmlyZSgnc3RhYmxlJywgaXNTdGFibGUpO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gb25HcmFwaENoYW5nZWQoY2hhbmdlcykge1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjaGFuZ2VzLmxlbmd0aDsgKytpKSB7XHJcbiAgICAgIHZhciBjaGFuZ2UgPSBjaGFuZ2VzW2ldO1xyXG4gICAgICBpZiAoY2hhbmdlLmNoYW5nZVR5cGUgPT09ICdhZGQnKSB7XHJcbiAgICAgICAgaWYgKGNoYW5nZS5ub2RlKSB7XHJcbiAgICAgICAgICBpbml0Qm9keShjaGFuZ2Uubm9kZS5pZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjaGFuZ2UubGluaykge1xyXG4gICAgICAgICAgaW5pdExpbmsoY2hhbmdlLmxpbmspO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIGlmIChjaGFuZ2UuY2hhbmdlVHlwZSA9PT0gJ3JlbW92ZScpIHtcclxuICAgICAgICBpZiAoY2hhbmdlLm5vZGUpIHtcclxuICAgICAgICAgIHJlbGVhc2VOb2RlKGNoYW5nZS5ub2RlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKGNoYW5nZS5saW5rKSB7XHJcbiAgICAgICAgICByZWxlYXNlTGluayhjaGFuZ2UubGluayk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBpbml0UGh5c2ljcygpIHtcclxuICAgIGdyYXBoLmZvckVhY2hOb2RlKGZ1bmN0aW9uIChub2RlKSB7XHJcbiAgICAgIGluaXRCb2R5KG5vZGUuaWQpO1xyXG4gICAgfSk7XHJcbiAgICBncmFwaC5mb3JFYWNoTGluayhpbml0TGluayk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBpbml0Qm9keShub2RlSWQpIHtcclxuICAgIHZhciBib2R5ID0gbm9kZUJvZGllc1tub2RlSWRdO1xyXG4gICAgaWYgKCFib2R5KSB7XHJcbiAgICAgIHZhciBub2RlID0gZ3JhcGguZ2V0Tm9kZShub2RlSWQpO1xyXG4gICAgICBpZiAoIW5vZGUpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2luaXRCb2R5KCkgd2FzIGNhbGxlZCB3aXRoIHVua25vd24gbm9kZSBpZCcpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB2YXIgcG9zID0gbm9kZS5wb3NpdGlvbjtcclxuICAgICAgaWYgKCFwb3MpIHtcclxuICAgICAgICB2YXIgbmVpZ2hib3JzID0gZ2V0TmVpZ2hib3JCb2RpZXMobm9kZSk7XHJcbiAgICAgICAgcG9zID0gcGh5c2ljc1NpbXVsYXRvci5nZXRCZXN0TmV3Qm9keVBvc2l0aW9uKG5laWdoYm9ycyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGJvZHkgPSBwaHlzaWNzU2ltdWxhdG9yLmFkZEJvZHlBdChwb3MpO1xyXG5cclxuICAgICAgbm9kZUJvZGllc1tub2RlSWRdID0gYm9keTtcclxuICAgICAgdXBkYXRlQm9keU1hc3Mobm9kZUlkKTtcclxuXHJcbiAgICAgIGlmIChpc05vZGVPcmlnaW5hbGx5UGlubmVkKG5vZGUpKSB7XHJcbiAgICAgICAgYm9keS5pc1Bpbm5lZCA9IHRydWU7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGZ1bmN0aW9uIHJlbGVhc2VOb2RlKG5vZGUpIHtcclxuICAgIHZhciBub2RlSWQgPSBub2RlLmlkO1xyXG4gICAgdmFyIGJvZHkgPSBub2RlQm9kaWVzW25vZGVJZF07XHJcbiAgICBpZiAoYm9keSkge1xyXG4gICAgICBub2RlQm9kaWVzW25vZGVJZF0gPSBudWxsO1xyXG4gICAgICBkZWxldGUgbm9kZUJvZGllc1tub2RlSWRdO1xyXG5cclxuICAgICAgcGh5c2ljc1NpbXVsYXRvci5yZW1vdmVCb2R5KGJvZHkpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gaW5pdExpbmsobGluaykge1xyXG4gICAgdXBkYXRlQm9keU1hc3MobGluay5mcm9tSWQpO1xyXG4gICAgdXBkYXRlQm9keU1hc3MobGluay50b0lkKTtcclxuXHJcbiAgICB2YXIgZnJvbUJvZHkgPSBub2RlQm9kaWVzW2xpbmsuZnJvbUlkXSxcclxuICAgICAgICB0b0JvZHkgID0gbm9kZUJvZGllc1tsaW5rLnRvSWRdLFxyXG4gICAgICAgIHNwcmluZyA9IHBoeXNpY3NTaW11bGF0b3IuYWRkU3ByaW5nKGZyb21Cb2R5LCB0b0JvZHksIGxpbmsubGVuZ3RoKTtcclxuXHJcbiAgICBzcHJpbmdUcmFuc2Zvcm0obGluaywgc3ByaW5nKTtcclxuXHJcbiAgICBzcHJpbmdzW2xpbmsuaWRdID0gc3ByaW5nO1xyXG4gIH1cclxuXHJcbiAgZnVuY3Rpb24gcmVsZWFzZUxpbmsobGluaykge1xyXG4gICAgdmFyIHNwcmluZyA9IHNwcmluZ3NbbGluay5pZF07XHJcbiAgICBpZiAoc3ByaW5nKSB7XHJcbiAgICAgIHZhciBmcm9tID0gZ3JhcGguZ2V0Tm9kZShsaW5rLmZyb21JZCksXHJcbiAgICAgICAgICB0byA9IGdyYXBoLmdldE5vZGUobGluay50b0lkKTtcclxuXHJcbiAgICAgIGlmIChmcm9tKSB1cGRhdGVCb2R5TWFzcyhmcm9tLmlkKTtcclxuICAgICAgaWYgKHRvKSB1cGRhdGVCb2R5TWFzcyh0by5pZCk7XHJcblxyXG4gICAgICBkZWxldGUgc3ByaW5nc1tsaW5rLmlkXTtcclxuXHJcbiAgICAgIHBoeXNpY3NTaW11bGF0b3IucmVtb3ZlU3ByaW5nKHNwcmluZyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBnZXROZWlnaGJvckJvZGllcyhub2RlKSB7XHJcbiAgICAvLyBUT0RPOiBDb3VsZCBwcm9iYWJseSBiZSBkb25lIGJldHRlciBvbiBtZW1vcnlcclxuICAgIHZhciBuZWlnaGJvcnMgPSBbXTtcclxuICAgIGlmICghbm9kZS5saW5rcykge1xyXG4gICAgICByZXR1cm4gbmVpZ2hib3JzO1xyXG4gICAgfVxyXG4gICAgdmFyIG1heE5laWdoYm9ycyA9IE1hdGgubWluKG5vZGUubGlua3MubGVuZ3RoLCAyKTtcclxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbWF4TmVpZ2hib3JzOyArK2kpIHtcclxuICAgICAgdmFyIGxpbmsgPSBub2RlLmxpbmtzW2ldO1xyXG4gICAgICB2YXIgb3RoZXJCb2R5ID0gbGluay5mcm9tSWQgIT09IG5vZGUuaWQgPyBub2RlQm9kaWVzW2xpbmsuZnJvbUlkXSA6IG5vZGVCb2RpZXNbbGluay50b0lkXTtcclxuICAgICAgaWYgKG90aGVyQm9keSAmJiBvdGhlckJvZHkucG9zKSB7XHJcbiAgICAgICAgbmVpZ2hib3JzLnB1c2gob3RoZXJCb2R5KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBuZWlnaGJvcnM7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiB1cGRhdGVCb2R5TWFzcyhub2RlSWQpIHtcclxuICAgIHZhciBib2R5ID0gbm9kZUJvZGllc1tub2RlSWRdO1xyXG4gICAgYm9keS5tYXNzID0gbm9kZU1hc3Mobm9kZUlkKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENoZWNrcyB3aGV0aGVyIGdyYXBoIG5vZGUgaGFzIGluIGl0cyBzZXR0aW5ncyBwaW5uZWQgYXR0cmlidXRlLFxyXG4gICAqIHdoaWNoIG1lYW5zIGxheW91dCBhbGdvcml0aG0gY2Fubm90IG1vdmUgaXQuIE5vZGUgY2FuIGJlIHByZWNvbmZpZ3VyZWRcclxuICAgKiBhcyBwaW5uZWQsIGlmIGl0IGhhcyBcImlzUGlubmVkXCIgYXR0cmlidXRlLCBvciB3aGVuIG5vZGUuZGF0YSBoYXMgaXQuXHJcbiAgICpcclxuICAgKiBAcGFyYW0ge09iamVjdH0gbm9kZSBhIGdyYXBoIG5vZGUgdG8gY2hlY2tcclxuICAgKiBAcmV0dXJuIHtCb29sZWFufSB0cnVlIGlmIG5vZGUgc2hvdWxkIGJlIHRyZWF0ZWQgYXMgcGlubmVkOyBmYWxzZSBvdGhlcndpc2UuXHJcbiAgICovXHJcbiAgZnVuY3Rpb24gaXNOb2RlT3JpZ2luYWxseVBpbm5lZChub2RlKSB7XHJcbiAgICByZXR1cm4gKG5vZGUgJiYgKG5vZGUuaXNQaW5uZWQgfHwgKG5vZGUuZGF0YSAmJiBub2RlLmRhdGEuaXNQaW5uZWQpKSk7XHJcbiAgfVxyXG5cclxuICBmdW5jdGlvbiBnZXRJbml0aWFsaXplZEJvZHkobm9kZUlkKSB7XHJcbiAgICB2YXIgYm9keSA9IG5vZGVCb2RpZXNbbm9kZUlkXTtcclxuICAgIGlmICghYm9keSkge1xyXG4gICAgICBpbml0Qm9keShub2RlSWQpO1xyXG4gICAgICBib2R5ID0gbm9kZUJvZGllc1tub2RlSWRdO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGJvZHk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDYWxjdWxhdGVzIG1hc3Mgb2YgYSBib2R5LCB3aGljaCBjb3JyZXNwb25kcyB0byBub2RlIHdpdGggZ2l2ZW4gaWQuXHJcbiAgICpcclxuICAgKiBAcGFyYW0ge1N0cmluZ3xOdW1iZXJ9IG5vZGVJZCBpZGVudGlmaWVyIG9mIGEgbm9kZSwgZm9yIHdoaWNoIGJvZHkgbWFzcyBuZWVkcyB0byBiZSBjYWxjdWxhdGVkXHJcbiAgICogQHJldHVybnMge051bWJlcn0gcmVjb21tZW5kZWQgbWFzcyBvZiB0aGUgYm9keTtcclxuICAgKi9cclxuICBmdW5jdGlvbiBub2RlTWFzcyhub2RlSWQpIHtcclxuICAgIHZhciBsaW5rcyA9IGdyYXBoLmdldExpbmtzKG5vZGVJZCk7XHJcbiAgICBpZiAoIWxpbmtzKSByZXR1cm4gMTtcclxuICAgIHJldHVybiAxICsgbGlua3MubGVuZ3RoIC8gMy4wO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gbm9vcCgpIHsgfVxyXG4iLCIvKipcbiAqIEBmaWxlT3ZlcnZpZXcgQ29udGFpbnMgZGVmaW5pdGlvbiBvZiB0aGUgY29yZSBncmFwaCBvYmplY3QuXG4gKi9cblxuLyoqXG4gKiBAZXhhbXBsZVxuICogIHZhciBncmFwaCA9IHJlcXVpcmUoJ25ncmFwaC5ncmFwaCcpKCk7XG4gKiAgZ3JhcGguYWRkTm9kZSgxKTsgICAgIC8vIGdyYXBoIGhhcyBvbmUgbm9kZS5cbiAqICBncmFwaC5hZGRMaW5rKDIsIDMpOyAgLy8gbm93IGdyYXBoIGNvbnRhaW5zIHRocmVlIG5vZGVzIGFuZCBvbmUgbGluay5cbiAqXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlR3JhcGg7XG5cbnZhciBldmVudGlmeSA9IHJlcXVpcmUoJ25ncmFwaC5ldmVudHMnKTtcblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGdyYXBoXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZUdyYXBoKG9wdGlvbnMpIHtcbiAgLy8gR3JhcGggc3RydWN0dXJlIGlzIG1haW50YWluZWQgYXMgZGljdGlvbmFyeSBvZiBub2Rlc1xuICAvLyBhbmQgYXJyYXkgb2YgbGlua3MuIEVhY2ggbm9kZSBoYXMgJ2xpbmtzJyBwcm9wZXJ0eSB3aGljaFxuICAvLyBob2xkIGFsbCBsaW5rcyByZWxhdGVkIHRvIHRoYXQgbm9kZS4gQW5kIGdlbmVyYWwgbGlua3NcbiAgLy8gYXJyYXkgaXMgdXNlZCB0byBzcGVlZCB1cCBhbGwgbGlua3MgZW51bWVyYXRpb24uIFRoaXMgaXMgaW5lZmZpY2llbnRcbiAgLy8gaW4gdGVybXMgb2YgbWVtb3J5LCBidXQgc2ltcGxpZmllcyBjb2RpbmcuXG4gIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICBpZiAob3B0aW9ucy51bmlxdWVMaW5rSWQgPT09IHVuZGVmaW5lZCkge1xuICAgIC8vIFJlcXVlc3QgZWFjaCBsaW5rIGlkIHRvIGJlIHVuaXF1ZSBiZXR3ZWVuIHNhbWUgbm9kZXMuIFRoaXMgbmVnYXRpdmVseVxuICAgIC8vIGltcGFjdHMgYGFkZExpbmsoKWAgcGVyZm9ybWFuY2UgKE8obiksIHdoZXJlIG4gLSBudW1iZXIgb2YgZWRnZXMgb2YgZWFjaFxuICAgIC8vIHZlcnRleCksIGJ1dCBtYWtlcyBvcGVyYXRpb25zIHdpdGggbXVsdGlncmFwaHMgbW9yZSBhY2Nlc3NpYmxlLlxuICAgIG9wdGlvbnMudW5pcXVlTGlua0lkID0gdHJ1ZTtcbiAgfVxuXG4gIHZhciBub2RlcyA9IHR5cGVvZiBPYmplY3QuY3JlYXRlID09PSAnZnVuY3Rpb24nID8gT2JqZWN0LmNyZWF0ZShudWxsKSA6IHt9LFxuICAgIGxpbmtzID0gW10sXG4gICAgLy8gSGFzaCBvZiBtdWx0aS1lZGdlcy4gVXNlZCB0byB0cmFjayBpZHMgb2YgZWRnZXMgYmV0d2VlbiBzYW1lIG5vZGVzXG4gICAgbXVsdGlFZGdlcyA9IHt9LFxuICAgIG5vZGVzQ291bnQgPSAwLFxuICAgIHN1c3BlbmRFdmVudHMgPSAwLFxuXG4gICAgZm9yRWFjaE5vZGUgPSBjcmVhdGVOb2RlSXRlcmF0b3IoKSxcbiAgICBjcmVhdGVMaW5rID0gb3B0aW9ucy51bmlxdWVMaW5rSWQgPyBjcmVhdGVVbmlxdWVMaW5rIDogY3JlYXRlU2luZ2xlTGluayxcblxuICAgIC8vIE91ciBncmFwaCBBUEkgcHJvdmlkZXMgbWVhbnMgdG8gbGlzdGVuIHRvIGdyYXBoIGNoYW5nZXMuIFVzZXJzIGNhbiBzdWJzY3JpYmVcbiAgICAvLyB0byBiZSBub3RpZmllZCBhYm91dCBjaGFuZ2VzIGluIHRoZSBncmFwaCBieSB1c2luZyBgb25gIG1ldGhvZC4gSG93ZXZlclxuICAgIC8vIGluIHNvbWUgY2FzZXMgdGhleSBkb24ndCB1c2UgaXQuIFRvIGF2b2lkIHVubmVjZXNzYXJ5IG1lbW9yeSBjb25zdW1wdGlvblxuICAgIC8vIHdlIHdpbGwgbm90IHJlY29yZCBncmFwaCBjaGFuZ2VzIHVudGlsIHdlIGhhdmUgYXQgbGVhc3Qgb25lIHN1YnNjcmliZXIuXG4gICAgLy8gQ29kZSBiZWxvdyBzdXBwb3J0cyB0aGlzIG9wdGltaXphdGlvbi5cbiAgICAvL1xuICAgIC8vIEFjY3VtdWxhdGVzIGFsbCBjaGFuZ2VzIG1hZGUgZHVyaW5nIGdyYXBoIHVwZGF0ZXMuXG4gICAgLy8gRWFjaCBjaGFuZ2UgZWxlbWVudCBjb250YWluczpcbiAgICAvLyAgY2hhbmdlVHlwZSAtIG9uZSBvZiB0aGUgc3RyaW5nczogJ2FkZCcsICdyZW1vdmUnIG9yICd1cGRhdGUnO1xuICAgIC8vICBub2RlIC0gaWYgY2hhbmdlIGlzIHJlbGF0ZWQgdG8gbm9kZSB0aGlzIHByb3BlcnR5IGlzIHNldCB0byBjaGFuZ2VkIGdyYXBoJ3Mgbm9kZTtcbiAgICAvLyAgbGluayAtIGlmIGNoYW5nZSBpcyByZWxhdGVkIHRvIGxpbmsgdGhpcyBwcm9wZXJ0eSBpcyBzZXQgdG8gY2hhbmdlZCBncmFwaCdzIGxpbms7XG4gICAgY2hhbmdlcyA9IFtdLFxuICAgIHJlY29yZExpbmtDaGFuZ2UgPSBub29wLFxuICAgIHJlY29yZE5vZGVDaGFuZ2UgPSBub29wLFxuICAgIGVudGVyTW9kaWZpY2F0aW9uID0gbm9vcCxcbiAgICBleGl0TW9kaWZpY2F0aW9uID0gbm9vcDtcblxuICAvLyB0aGlzIGlzIG91ciBwdWJsaWMgQVBJOlxuICB2YXIgZ3JhcGhQYXJ0ID0ge1xuICAgIC8qKlxuICAgICAqIEFkZHMgbm9kZSB0byB0aGUgZ3JhcGguIElmIG5vZGUgd2l0aCBnaXZlbiBpZCBhbHJlYWR5IGV4aXN0cyBpbiB0aGUgZ3JhcGhcbiAgICAgKiBpdHMgZGF0YSBpcyBleHRlbmRlZCB3aXRoIHdoYXRldmVyIGNvbWVzIGluICdkYXRhJyBhcmd1bWVudC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBub2RlSWQgdGhlIG5vZGUncyBpZGVudGlmaWVyLiBBIHN0cmluZyBvciBudW1iZXIgaXMgcHJlZmVycmVkLlxuICAgICAqIEBwYXJhbSBbZGF0YV0gYWRkaXRpb25hbCBkYXRhIGZvciB0aGUgbm9kZSBiZWluZyBhZGRlZC4gSWYgbm9kZSBhbHJlYWR5XG4gICAgICogICBleGlzdHMgaXRzIGRhdGEgb2JqZWN0IGlzIGF1Z21lbnRlZCB3aXRoIHRoZSBuZXcgb25lLlxuICAgICAqXG4gICAgICogQHJldHVybiB7bm9kZX0gVGhlIG5ld2x5IGFkZGVkIG5vZGUgb3Igbm9kZSB3aXRoIGdpdmVuIGlkIGlmIGl0IGFscmVhZHkgZXhpc3RzLlxuICAgICAqL1xuICAgIGFkZE5vZGU6IGFkZE5vZGUsXG5cbiAgICAvKipcbiAgICAgKiBBZGRzIGEgbGluayB0byB0aGUgZ3JhcGguIFRoZSBmdW5jdGlvbiBhbHdheXMgY3JlYXRlIGEgbmV3XG4gICAgICogbGluayBiZXR3ZWVuIHR3byBub2Rlcy4gSWYgb25lIG9mIHRoZSBub2RlcyBkb2VzIG5vdCBleGlzdHNcbiAgICAgKiBhIG5ldyBub2RlIGlzIGNyZWF0ZWQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gZnJvbUlkIGxpbmsgc3RhcnQgbm9kZSBpZDtcbiAgICAgKiBAcGFyYW0gdG9JZCBsaW5rIGVuZCBub2RlIGlkO1xuICAgICAqIEBwYXJhbSBbZGF0YV0gYWRkaXRpb25hbCBkYXRhIHRvIGJlIHNldCBvbiB0aGUgbmV3IGxpbms7XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHtsaW5rfSBUaGUgbmV3bHkgY3JlYXRlZCBsaW5rXG4gICAgICovXG4gICAgYWRkTGluazogYWRkTGluayxcblxuICAgIC8qKlxuICAgICAqIFJlbW92ZXMgbGluayBmcm9tIHRoZSBncmFwaC4gSWYgbGluayBkb2VzIG5vdCBleGlzdCBkb2VzIG5vdGhpbmcuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbGluayAtIG9iamVjdCByZXR1cm5lZCBieSBhZGRMaW5rKCkgb3IgZ2V0TGlua3MoKSBtZXRob2RzLlxuICAgICAqXG4gICAgICogQHJldHVybnMgdHJ1ZSBpZiBsaW5rIHdhcyByZW1vdmVkOyBmYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgcmVtb3ZlTGluazogcmVtb3ZlTGluayxcblxuICAgIC8qKlxuICAgICAqIFJlbW92ZXMgbm9kZSB3aXRoIGdpdmVuIGlkIGZyb20gdGhlIGdyYXBoLiBJZiBub2RlIGRvZXMgbm90IGV4aXN0IGluIHRoZSBncmFwaFxuICAgICAqIGRvZXMgbm90aGluZy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBub2RlSWQgbm9kZSdzIGlkZW50aWZpZXIgcGFzc2VkIHRvIGFkZE5vZGUoKSBmdW5jdGlvbi5cbiAgICAgKlxuICAgICAqIEByZXR1cm5zIHRydWUgaWYgbm9kZSB3YXMgcmVtb3ZlZDsgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIHJlbW92ZU5vZGU6IHJlbW92ZU5vZGUsXG5cbiAgICAvKipcbiAgICAgKiBHZXRzIG5vZGUgd2l0aCBnaXZlbiBpZGVudGlmaWVyLiBJZiBub2RlIGRvZXMgbm90IGV4aXN0IHVuZGVmaW5lZCB2YWx1ZSBpcyByZXR1cm5lZC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBub2RlSWQgcmVxdWVzdGVkIG5vZGUgaWRlbnRpZmllcjtcbiAgICAgKlxuICAgICAqIEByZXR1cm4ge25vZGV9IGluIHdpdGggcmVxdWVzdGVkIGlkZW50aWZpZXIgb3IgdW5kZWZpbmVkIGlmIG5vIHN1Y2ggbm9kZSBleGlzdHMuXG4gICAgICovXG4gICAgZ2V0Tm9kZTogZ2V0Tm9kZSxcblxuICAgIC8qKlxuICAgICAqIEdldHMgbnVtYmVyIG9mIG5vZGVzIGluIHRoaXMgZ3JhcGguXG4gICAgICpcbiAgICAgKiBAcmV0dXJuIG51bWJlciBvZiBub2RlcyBpbiB0aGUgZ3JhcGguXG4gICAgICovXG4gICAgZ2V0Tm9kZXNDb3VudDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gbm9kZXNDb3VudDtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogR2V0cyB0b3RhbCBudW1iZXIgb2YgbGlua3MgaW4gdGhlIGdyYXBoLlxuICAgICAqL1xuICAgIGdldExpbmtzQ291bnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGxpbmtzLmxlbmd0aDtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogR2V0cyBhbGwgbGlua3MgKGluYm91bmQgYW5kIG91dGJvdW5kKSBmcm9tIHRoZSBub2RlIHdpdGggZ2l2ZW4gaWQuXG4gICAgICogSWYgbm9kZSB3aXRoIGdpdmVuIGlkIGlzIG5vdCBmb3VuZCBudWxsIGlzIHJldHVybmVkLlxuICAgICAqXG4gICAgICogQHBhcmFtIG5vZGVJZCByZXF1ZXN0ZWQgbm9kZSBpZGVudGlmaWVyLlxuICAgICAqXG4gICAgICogQHJldHVybiBBcnJheSBvZiBsaW5rcyBmcm9tIGFuZCB0byByZXF1ZXN0ZWQgbm9kZSBpZiBzdWNoIG5vZGUgZXhpc3RzO1xuICAgICAqICAgb3RoZXJ3aXNlIG51bGwgaXMgcmV0dXJuZWQuXG4gICAgICovXG4gICAgZ2V0TGlua3M6IGdldExpbmtzLFxuXG4gICAgLyoqXG4gICAgICogSW52b2tlcyBjYWxsYmFjayBvbiBlYWNoIG5vZGUgb2YgdGhlIGdyYXBoLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbihub2RlKX0gY2FsbGJhY2sgRnVuY3Rpb24gdG8gYmUgaW52b2tlZC4gVGhlIGZ1bmN0aW9uXG4gICAgICogICBpcyBwYXNzZWQgb25lIGFyZ3VtZW50OiB2aXNpdGVkIG5vZGUuXG4gICAgICovXG4gICAgZm9yRWFjaE5vZGU6IGZvckVhY2hOb2RlLFxuXG4gICAgLyoqXG4gICAgICogSW52b2tlcyBjYWxsYmFjayBvbiBldmVyeSBsaW5rZWQgKGFkamFjZW50KSBub2RlIHRvIHRoZSBnaXZlbiBvbmUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gbm9kZUlkIElkZW50aWZpZXIgb2YgdGhlIHJlcXVlc3RlZCBub2RlLlxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb24obm9kZSwgbGluayl9IGNhbGxiYWNrIEZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBvbiBhbGwgbGlua2VkIG5vZGVzLlxuICAgICAqICAgVGhlIGZ1bmN0aW9uIGlzIHBhc3NlZCB0d28gcGFyYW1ldGVyczogYWRqYWNlbnQgbm9kZSBhbmQgbGluayBvYmplY3QgaXRzZWxmLlxuICAgICAqIEBwYXJhbSBvcmllbnRlZCBpZiB0cnVlIGdyYXBoIHRyZWF0ZWQgYXMgb3JpZW50ZWQuXG4gICAgICovXG4gICAgZm9yRWFjaExpbmtlZE5vZGU6IGZvckVhY2hMaW5rZWROb2RlLFxuXG4gICAgLyoqXG4gICAgICogRW51bWVyYXRlcyBhbGwgbGlua3MgaW4gdGhlIGdyYXBoXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9uKGxpbmspfSBjYWxsYmFjayBGdW5jdGlvbiB0byBiZSBjYWxsZWQgb24gYWxsIGxpbmtzIGluIHRoZSBncmFwaC5cbiAgICAgKiAgIFRoZSBmdW5jdGlvbiBpcyBwYXNzZWQgb25lIHBhcmFtZXRlcjogZ3JhcGgncyBsaW5rIG9iamVjdC5cbiAgICAgKlxuICAgICAqIExpbmsgb2JqZWN0IGNvbnRhaW5zIGF0IGxlYXN0IHRoZSBmb2xsb3dpbmcgZmllbGRzOlxuICAgICAqICBmcm9tSWQgLSBub2RlIGlkIHdoZXJlIGxpbmsgc3RhcnRzO1xuICAgICAqICB0b0lkIC0gbm9kZSBpZCB3aGVyZSBsaW5rIGVuZHMsXG4gICAgICogIGRhdGEgLSBhZGRpdGlvbmFsIGRhdGEgcGFzc2VkIHRvIGdyYXBoLmFkZExpbmsoKSBtZXRob2QuXG4gICAgICovXG4gICAgZm9yRWFjaExpbms6IGZvckVhY2hMaW5rLFxuXG4gICAgLyoqXG4gICAgICogU3VzcGVuZCBhbGwgbm90aWZpY2F0aW9ucyBhYm91dCBncmFwaCBjaGFuZ2VzIHVudGlsXG4gICAgICogZW5kVXBkYXRlIGlzIGNhbGxlZC5cbiAgICAgKi9cbiAgICBiZWdpblVwZGF0ZTogZW50ZXJNb2RpZmljYXRpb24sXG5cbiAgICAvKipcbiAgICAgKiBSZXN1bWVzIGFsbCBub3RpZmljYXRpb25zIGFib3V0IGdyYXBoIGNoYW5nZXMgYW5kIGZpcmVzXG4gICAgICogZ3JhcGggJ2NoYW5nZWQnIGV2ZW50IGluIGNhc2UgdGhlcmUgYXJlIGFueSBwZW5kaW5nIGNoYW5nZXMuXG4gICAgICovXG4gICAgZW5kVXBkYXRlOiBleGl0TW9kaWZpY2F0aW9uLFxuXG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyBhbGwgbm9kZXMgYW5kIGxpbmtzIGZyb20gdGhlIGdyYXBoLlxuICAgICAqL1xuICAgIGNsZWFyOiBjbGVhcixcblxuICAgIC8qKlxuICAgICAqIERldGVjdHMgd2hldGhlciB0aGVyZSBpcyBhIGxpbmsgYmV0d2VlbiB0d28gbm9kZXMuXG4gICAgICogT3BlcmF0aW9uIGNvbXBsZXhpdHkgaXMgTyhuKSB3aGVyZSBuIC0gbnVtYmVyIG9mIGxpbmtzIG9mIGEgbm9kZS5cbiAgICAgKiBOT1RFOiB0aGlzIGZ1bmN0aW9uIGlzIHN5bm9uaW0gZm9yIGdldExpbmsoKVxuICAgICAqXG4gICAgICogQHJldHVybnMgbGluayBpZiB0aGVyZSBpcyBvbmUuIG51bGwgb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIGhhc0xpbms6IGdldExpbmssXG5cbiAgICAvKipcbiAgICAgKiBHZXRzIGFuIGVkZ2UgYmV0d2VlbiB0d28gbm9kZXMuXG4gICAgICogT3BlcmF0aW9uIGNvbXBsZXhpdHkgaXMgTyhuKSB3aGVyZSBuIC0gbnVtYmVyIG9mIGxpbmtzIG9mIGEgbm9kZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmcm9tSWQgbGluayBzdGFydCBpZGVudGlmaWVyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRvSWQgbGluayBlbmQgaWRlbnRpZmllclxuICAgICAqXG4gICAgICogQHJldHVybnMgbGluayBpZiB0aGVyZSBpcyBvbmUuIG51bGwgb3RoZXJ3aXNlLlxuICAgICAqL1xuICAgIGdldExpbms6IGdldExpbmtcbiAgfTtcblxuICAvLyB0aGlzIHdpbGwgYWRkIGBvbigpYCBhbmQgYGZpcmUoKWAgbWV0aG9kcy5cbiAgZXZlbnRpZnkoZ3JhcGhQYXJ0KTtcblxuICBtb25pdG9yU3Vic2NyaWJlcnMoKTtcblxuICByZXR1cm4gZ3JhcGhQYXJ0O1xuXG4gIGZ1bmN0aW9uIG1vbml0b3JTdWJzY3JpYmVycygpIHtcbiAgICB2YXIgcmVhbE9uID0gZ3JhcGhQYXJ0Lm9uO1xuXG4gICAgLy8gcmVwbGFjZSByZWFsIGBvbmAgd2l0aCBvdXIgdGVtcG9yYXJ5IG9uLCB3aGljaCB3aWxsIHRyaWdnZXIgY2hhbmdlXG4gICAgLy8gbW9kaWZpY2F0aW9uIG1vbml0b3Jpbmc6XG4gICAgZ3JhcGhQYXJ0Lm9uID0gb247XG5cbiAgICBmdW5jdGlvbiBvbigpIHtcbiAgICAgIC8vIG5vdyBpdCdzIHRpbWUgdG8gc3RhcnQgdHJhY2tpbmcgc3R1ZmY6XG4gICAgICBncmFwaFBhcnQuYmVnaW5VcGRhdGUgPSBlbnRlck1vZGlmaWNhdGlvbiA9IGVudGVyTW9kaWZpY2F0aW9uUmVhbDtcbiAgICAgIGdyYXBoUGFydC5lbmRVcGRhdGUgPSBleGl0TW9kaWZpY2F0aW9uID0gZXhpdE1vZGlmaWNhdGlvblJlYWw7XG4gICAgICByZWNvcmRMaW5rQ2hhbmdlID0gcmVjb3JkTGlua0NoYW5nZVJlYWw7XG4gICAgICByZWNvcmROb2RlQ2hhbmdlID0gcmVjb3JkTm9kZUNoYW5nZVJlYWw7XG5cbiAgICAgIC8vIHRoaXMgd2lsbCByZXBsYWNlIGN1cnJlbnQgYG9uYCBtZXRob2Qgd2l0aCByZWFsIHB1Yi9zdWIgZnJvbSBgZXZlbnRpZnlgLlxuICAgICAgZ3JhcGhQYXJ0Lm9uID0gcmVhbE9uO1xuICAgICAgLy8gZGVsZWdhdGUgdG8gcmVhbCBgb25gIGhhbmRsZXI6XG4gICAgICByZXR1cm4gcmVhbE9uLmFwcGx5KGdyYXBoUGFydCwgYXJndW1lbnRzKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiByZWNvcmRMaW5rQ2hhbmdlUmVhbChsaW5rLCBjaGFuZ2VUeXBlKSB7XG4gICAgY2hhbmdlcy5wdXNoKHtcbiAgICAgIGxpbms6IGxpbmssXG4gICAgICBjaGFuZ2VUeXBlOiBjaGFuZ2VUeXBlXG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiByZWNvcmROb2RlQ2hhbmdlUmVhbChub2RlLCBjaGFuZ2VUeXBlKSB7XG4gICAgY2hhbmdlcy5wdXNoKHtcbiAgICAgIG5vZGU6IG5vZGUsXG4gICAgICBjaGFuZ2VUeXBlOiBjaGFuZ2VUeXBlXG4gICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBhZGROb2RlKG5vZGVJZCwgZGF0YSkge1xuICAgIGlmIChub2RlSWQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIG5vZGUgaWRlbnRpZmllcicpO1xuICAgIH1cblxuICAgIGVudGVyTW9kaWZpY2F0aW9uKCk7XG5cbiAgICB2YXIgbm9kZSA9IGdldE5vZGUobm9kZUlkKTtcbiAgICBpZiAoIW5vZGUpIHtcbiAgICAgIG5vZGUgPSBuZXcgTm9kZShub2RlSWQpO1xuICAgICAgbm9kZXNDb3VudCsrO1xuICAgICAgcmVjb3JkTm9kZUNoYW5nZShub2RlLCAnYWRkJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlY29yZE5vZGVDaGFuZ2Uobm9kZSwgJ3VwZGF0ZScpO1xuICAgIH1cblxuICAgIG5vZGUuZGF0YSA9IGRhdGE7XG5cbiAgICBub2Rlc1tub2RlSWRdID0gbm9kZTtcblxuICAgIGV4aXRNb2RpZmljYXRpb24oKTtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdldE5vZGUobm9kZUlkKSB7XG4gICAgcmV0dXJuIG5vZGVzW25vZGVJZF07XG4gIH1cblxuICBmdW5jdGlvbiByZW1vdmVOb2RlKG5vZGVJZCkge1xuICAgIHZhciBub2RlID0gZ2V0Tm9kZShub2RlSWQpO1xuICAgIGlmICghbm9kZSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGVudGVyTW9kaWZpY2F0aW9uKCk7XG5cbiAgICBpZiAobm9kZS5saW5rcykge1xuICAgICAgd2hpbGUgKG5vZGUubGlua3MubGVuZ3RoKSB7XG4gICAgICAgIHZhciBsaW5rID0gbm9kZS5saW5rc1swXTtcbiAgICAgICAgcmVtb3ZlTGluayhsaW5rKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBkZWxldGUgbm9kZXNbbm9kZUlkXTtcbiAgICBub2Rlc0NvdW50LS07XG5cbiAgICByZWNvcmROb2RlQ2hhbmdlKG5vZGUsICdyZW1vdmUnKTtcblxuICAgIGV4aXRNb2RpZmljYXRpb24oKTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9XG5cblxuICBmdW5jdGlvbiBhZGRMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSkge1xuICAgIGVudGVyTW9kaWZpY2F0aW9uKCk7XG5cbiAgICB2YXIgZnJvbU5vZGUgPSBnZXROb2RlKGZyb21JZCkgfHwgYWRkTm9kZShmcm9tSWQpO1xuICAgIHZhciB0b05vZGUgPSBnZXROb2RlKHRvSWQpIHx8IGFkZE5vZGUodG9JZCk7XG5cbiAgICB2YXIgbGluayA9IGNyZWF0ZUxpbmsoZnJvbUlkLCB0b0lkLCBkYXRhKTtcblxuICAgIGxpbmtzLnB1c2gobGluayk7XG5cbiAgICAvLyBUT0RPOiB0aGlzIGlzIG5vdCBjb29sLiBPbiBsYXJnZSBncmFwaHMgcG90ZW50aWFsbHkgd291bGQgY29uc3VtZSBtb3JlIG1lbW9yeS5cbiAgICBhZGRMaW5rVG9Ob2RlKGZyb21Ob2RlLCBsaW5rKTtcbiAgICBpZiAoZnJvbUlkICE9PSB0b0lkKSB7XG4gICAgICAvLyBtYWtlIHN1cmUgd2UgYXJlIG5vdCBkdXBsaWNhdGluZyBsaW5rcyBmb3Igc2VsZi1sb29wc1xuICAgICAgYWRkTGlua1RvTm9kZSh0b05vZGUsIGxpbmspO1xuICAgIH1cblxuICAgIHJlY29yZExpbmtDaGFuZ2UobGluaywgJ2FkZCcpO1xuXG4gICAgZXhpdE1vZGlmaWNhdGlvbigpO1xuXG4gICAgcmV0dXJuIGxpbms7XG4gIH1cblxuICBmdW5jdGlvbiBjcmVhdGVTaW5nbGVMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSkge1xuICAgIHZhciBsaW5rSWQgPSBtYWtlTGlua0lkKGZyb21JZCwgdG9JZCk7XG4gICAgcmV0dXJuIG5ldyBMaW5rKGZyb21JZCwgdG9JZCwgZGF0YSwgbGlua0lkKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGNyZWF0ZVVuaXF1ZUxpbmsoZnJvbUlkLCB0b0lkLCBkYXRhKSB7XG4gICAgLy8gVE9ETzogR2V0IHJpZCBvZiB0aGlzIG1ldGhvZC5cbiAgICB2YXIgbGlua0lkID0gbWFrZUxpbmtJZChmcm9tSWQsIHRvSWQpO1xuICAgIHZhciBpc011bHRpRWRnZSA9IG11bHRpRWRnZXMuaGFzT3duUHJvcGVydHkobGlua0lkKTtcbiAgICBpZiAoaXNNdWx0aUVkZ2UgfHwgZ2V0TGluayhmcm9tSWQsIHRvSWQpKSB7XG4gICAgICBpZiAoIWlzTXVsdGlFZGdlKSB7XG4gICAgICAgIG11bHRpRWRnZXNbbGlua0lkXSA9IDA7XG4gICAgICB9XG4gICAgICB2YXIgc3VmZml4ID0gJ0AnICsgKCsrbXVsdGlFZGdlc1tsaW5rSWRdKTtcbiAgICAgIGxpbmtJZCA9IG1ha2VMaW5rSWQoZnJvbUlkICsgc3VmZml4LCB0b0lkICsgc3VmZml4KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IExpbmsoZnJvbUlkLCB0b0lkLCBkYXRhLCBsaW5rSWQpO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0TGlua3Mobm9kZUlkKSB7XG4gICAgdmFyIG5vZGUgPSBnZXROb2RlKG5vZGVJZCk7XG4gICAgcmV0dXJuIG5vZGUgPyBub2RlLmxpbmtzIDogbnVsbDtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlbW92ZUxpbmsobGluaykge1xuICAgIGlmICghbGluaykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB2YXIgaWR4ID0gaW5kZXhPZkVsZW1lbnRJbkFycmF5KGxpbmssIGxpbmtzKTtcbiAgICBpZiAoaWR4IDwgMCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGVudGVyTW9kaWZpY2F0aW9uKCk7XG5cbiAgICBsaW5rcy5zcGxpY2UoaWR4LCAxKTtcblxuICAgIHZhciBmcm9tTm9kZSA9IGdldE5vZGUobGluay5mcm9tSWQpO1xuICAgIHZhciB0b05vZGUgPSBnZXROb2RlKGxpbmsudG9JZCk7XG5cbiAgICBpZiAoZnJvbU5vZGUpIHtcbiAgICAgIGlkeCA9IGluZGV4T2ZFbGVtZW50SW5BcnJheShsaW5rLCBmcm9tTm9kZS5saW5rcyk7XG4gICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgZnJvbU5vZGUubGlua3Muc3BsaWNlKGlkeCwgMSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRvTm9kZSkge1xuICAgICAgaWR4ID0gaW5kZXhPZkVsZW1lbnRJbkFycmF5KGxpbmssIHRvTm9kZS5saW5rcyk7XG4gICAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgICAgdG9Ob2RlLmxpbmtzLnNwbGljZShpZHgsIDEpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJlY29yZExpbmtDaGFuZ2UobGluaywgJ3JlbW92ZScpO1xuXG4gICAgZXhpdE1vZGlmaWNhdGlvbigpO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBmdW5jdGlvbiBnZXRMaW5rKGZyb21Ob2RlSWQsIHRvTm9kZUlkKSB7XG4gICAgLy8gVE9ETzogVXNlIHNvcnRlZCBsaW5rcyB0byBzcGVlZCB0aGlzIHVwXG4gICAgdmFyIG5vZGUgPSBnZXROb2RlKGZyb21Ob2RlSWQpLFxuICAgICAgaTtcbiAgICBpZiAoIW5vZGUgfHwgIW5vZGUubGlua3MpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDA7IGkgPCBub2RlLmxpbmtzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbGluayA9IG5vZGUubGlua3NbaV07XG4gICAgICBpZiAobGluay5mcm9tSWQgPT09IGZyb21Ob2RlSWQgJiYgbGluay50b0lkID09PSB0b05vZGVJZCkge1xuICAgICAgICByZXR1cm4gbGluaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDsgLy8gbm8gbGluay5cbiAgfVxuXG4gIGZ1bmN0aW9uIGNsZWFyKCkge1xuICAgIGVudGVyTW9kaWZpY2F0aW9uKCk7XG4gICAgZm9yRWFjaE5vZGUoZnVuY3Rpb24obm9kZSkge1xuICAgICAgcmVtb3ZlTm9kZShub2RlLmlkKTtcbiAgICB9KTtcbiAgICBleGl0TW9kaWZpY2F0aW9uKCk7XG4gIH1cblxuICBmdW5jdGlvbiBmb3JFYWNoTGluayhjYWxsYmFjaykge1xuICAgIHZhciBpLCBsZW5ndGg7XG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgZm9yIChpID0gMCwgbGVuZ3RoID0gbGlua3MubGVuZ3RoOyBpIDwgbGVuZ3RoOyArK2kpIHtcbiAgICAgICAgY2FsbGJhY2sobGlua3NbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZvckVhY2hMaW5rZWROb2RlKG5vZGVJZCwgY2FsbGJhY2ssIG9yaWVudGVkKSB7XG4gICAgdmFyIG5vZGUgPSBnZXROb2RlKG5vZGVJZCk7XG5cbiAgICBpZiAobm9kZSAmJiBub2RlLmxpbmtzICYmIHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKG9yaWVudGVkKSB7XG4gICAgICAgIHJldHVybiBmb3JFYWNoT3JpZW50ZWRMaW5rKG5vZGUubGlua3MsIG5vZGVJZCwgY2FsbGJhY2spO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGZvckVhY2hOb25PcmllbnRlZExpbmsobm9kZS5saW5rcywgbm9kZUlkLCBjYWxsYmFjayk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZm9yRWFjaE5vbk9yaWVudGVkTGluayhsaW5rcywgbm9kZUlkLCBjYWxsYmFjaykge1xuICAgIHZhciBxdWl0RmFzdDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmtzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbGluayA9IGxpbmtzW2ldO1xuICAgICAgdmFyIGxpbmtlZE5vZGVJZCA9IGxpbmsuZnJvbUlkID09PSBub2RlSWQgPyBsaW5rLnRvSWQgOiBsaW5rLmZyb21JZDtcblxuICAgICAgcXVpdEZhc3QgPSBjYWxsYmFjayhub2Rlc1tsaW5rZWROb2RlSWRdLCBsaW5rKTtcbiAgICAgIGlmIChxdWl0RmFzdCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTsgLy8gQ2xpZW50IGRvZXMgbm90IG5lZWQgbW9yZSBpdGVyYXRpb25zLiBCcmVhayBub3cuXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZm9yRWFjaE9yaWVudGVkTGluayhsaW5rcywgbm9kZUlkLCBjYWxsYmFjaykge1xuICAgIHZhciBxdWl0RmFzdDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmtzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgbGluayA9IGxpbmtzW2ldO1xuICAgICAgaWYgKGxpbmsuZnJvbUlkID09PSBub2RlSWQpIHtcbiAgICAgICAgcXVpdEZhc3QgPSBjYWxsYmFjayhub2Rlc1tsaW5rLnRvSWRdLCBsaW5rKTtcbiAgICAgICAgaWYgKHF1aXRGYXN0KSB7XG4gICAgICAgICAgcmV0dXJuIHRydWU7IC8vIENsaWVudCBkb2VzIG5vdCBuZWVkIG1vcmUgaXRlcmF0aW9ucy4gQnJlYWsgbm93LlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gd2Ugd2lsbCBub3QgZmlyZSBhbnl0aGluZyB1bnRpbCB1c2VycyBvZiB0aGlzIGxpYnJhcnkgZXhwbGljaXRseSBjYWxsIGBvbigpYFxuICAvLyBtZXRob2QuXG4gIGZ1bmN0aW9uIG5vb3AoKSB7fVxuXG4gIC8vIEVudGVyLCBFeGl0IG1vZGlmaWNhdGlvbiBhbGxvd3MgYnVsayBncmFwaCB1cGRhdGVzIHdpdGhvdXQgZmlyaW5nIGV2ZW50cy5cbiAgZnVuY3Rpb24gZW50ZXJNb2RpZmljYXRpb25SZWFsKCkge1xuICAgIHN1c3BlbmRFdmVudHMgKz0gMTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGV4aXRNb2RpZmljYXRpb25SZWFsKCkge1xuICAgIHN1c3BlbmRFdmVudHMgLT0gMTtcbiAgICBpZiAoc3VzcGVuZEV2ZW50cyA9PT0gMCAmJiBjaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgIGdyYXBoUGFydC5maXJlKCdjaGFuZ2VkJywgY2hhbmdlcyk7XG4gICAgICBjaGFuZ2VzLmxlbmd0aCA9IDA7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gY3JlYXRlTm9kZUl0ZXJhdG9yKCkge1xuICAgIC8vIE9iamVjdC5rZXlzIGl0ZXJhdG9yIGlzIDEuM3ggZmFzdGVyIHRoYW4gYGZvciBpbmAgbG9vcC5cbiAgICAvLyBTZWUgYGh0dHBzOi8vZ2l0aHViLmNvbS9hbnZha2EvbmdyYXBoLmdyYXBoL3RyZWUvYmVuY2gtZm9yLWluLXZzLW9iai1rZXlzYFxuICAgIC8vIGJyYW5jaCBmb3IgcGVyZiB0ZXN0XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzID8gb2JqZWN0S2V5c0l0ZXJhdG9yIDogZm9ySW5JdGVyYXRvcjtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9iamVjdEtleXNJdGVyYXRvcihjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKG5vZGVzKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGtleXMubGVuZ3RoOyArK2kpIHtcbiAgICAgIGlmIChjYWxsYmFjayhub2Rlc1trZXlzW2ldXSkpIHtcbiAgICAgICAgcmV0dXJuIHRydWU7IC8vIGNsaWVudCBkb2Vzbid0IHdhbnQgdG8gcHJvY2VlZC4gUmV0dXJuLlxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGZvckluSXRlcmF0b3IoY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBub2RlO1xuXG4gICAgZm9yIChub2RlIGluIG5vZGVzKSB7XG4gICAgICBpZiAoY2FsbGJhY2sobm9kZXNbbm9kZV0pKSB7XG4gICAgICAgIHJldHVybiB0cnVlOyAvLyBjbGllbnQgZG9lc24ndCB3YW50IHRvIHByb2NlZWQuIFJldHVybi5cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gbmVlZCB0aGlzIGZvciBvbGQgYnJvd3NlcnMuIFNob3VsZCB0aGlzIGJlIGEgc2VwYXJhdGUgbW9kdWxlP1xuZnVuY3Rpb24gaW5kZXhPZkVsZW1lbnRJbkFycmF5KGVsZW1lbnQsIGFycmF5KSB7XG4gIGlmICghYXJyYXkpIHJldHVybiAtMTtcblxuICBpZiAoYXJyYXkuaW5kZXhPZikge1xuICAgIHJldHVybiBhcnJheS5pbmRleE9mKGVsZW1lbnQpO1xuICB9XG5cbiAgdmFyIGxlbiA9IGFycmF5Lmxlbmd0aCxcbiAgICBpO1xuXG4gIGZvciAoaSA9IDA7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgIGlmIChhcnJheVtpXSA9PT0gZWxlbWVudCkge1xuICAgICAgcmV0dXJuIGk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIC0xO1xufVxuXG4vKipcbiAqIEludGVybmFsIHN0cnVjdHVyZSB0byByZXByZXNlbnQgbm9kZTtcbiAqL1xuZnVuY3Rpb24gTm9kZShpZCkge1xuICB0aGlzLmlkID0gaWQ7XG4gIHRoaXMubGlua3MgPSBudWxsO1xuICB0aGlzLmRhdGEgPSBudWxsO1xufVxuXG5mdW5jdGlvbiBhZGRMaW5rVG9Ob2RlKG5vZGUsIGxpbmspIHtcbiAgaWYgKG5vZGUubGlua3MpIHtcbiAgICBub2RlLmxpbmtzLnB1c2gobGluayk7XG4gIH0gZWxzZSB7XG4gICAgbm9kZS5saW5rcyA9IFtsaW5rXTtcbiAgfVxufVxuXG4vKipcbiAqIEludGVybmFsIHN0cnVjdHVyZSB0byByZXByZXNlbnQgbGlua3M7XG4gKi9cbmZ1bmN0aW9uIExpbmsoZnJvbUlkLCB0b0lkLCBkYXRhLCBpZCkge1xuICB0aGlzLmZyb21JZCA9IGZyb21JZDtcbiAgdGhpcy50b0lkID0gdG9JZDtcbiAgdGhpcy5kYXRhID0gZGF0YTtcbiAgdGhpcy5pZCA9IGlkO1xufVxuXG5mdW5jdGlvbiBoYXNoQ29kZShzdHIpIHtcbiAgdmFyIGhhc2ggPSAwLCBpLCBjaHIsIGxlbjtcbiAgaWYgKHN0ci5sZW5ndGggPT0gMCkgcmV0dXJuIGhhc2g7XG4gIGZvciAoaSA9IDAsIGxlbiA9IHN0ci5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgIGNociAgID0gc3RyLmNoYXJDb2RlQXQoaSk7XG4gICAgaGFzaCAgPSAoKGhhc2ggPDwgNSkgLSBoYXNoKSArIGNocjtcbiAgICBoYXNoIHw9IDA7IC8vIENvbnZlcnQgdG8gMzJiaXQgaW50ZWdlclxuICB9XG4gIHJldHVybiBoYXNoO1xufVxuXG5mdW5jdGlvbiBtYWtlTGlua0lkKGZyb21JZCwgdG9JZCkge1xuICByZXR1cm4gaGFzaENvZGUoZnJvbUlkLnRvU3RyaW5nKCkgKyAn8J+RiSAnICsgdG9JZC50b1N0cmluZygpKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gbWVyZ2U7XG5cbi8qKlxuICogQXVnbWVudHMgYHRhcmdldGAgd2l0aCBwcm9wZXJ0aWVzIGluIGBvcHRpb25zYC4gRG9lcyBub3Qgb3ZlcnJpZGVcbiAqIHRhcmdldCdzIHByb3BlcnRpZXMgaWYgdGhleSBhcmUgZGVmaW5lZCBhbmQgbWF0Y2hlcyBleHBlY3RlZCB0eXBlIGluIFxuICogb3B0aW9uc1xuICpcbiAqIEByZXR1cm5zIHtPYmplY3R9IG1lcmdlZCBvYmplY3RcbiAqL1xuZnVuY3Rpb24gbWVyZ2UodGFyZ2V0LCBvcHRpb25zKSB7XG4gIHZhciBrZXk7XG4gIGlmICghdGFyZ2V0KSB7IHRhcmdldCA9IHt9OyB9XG4gIGlmIChvcHRpb25zKSB7XG4gICAgZm9yIChrZXkgaW4gb3B0aW9ucykge1xuICAgICAgaWYgKG9wdGlvbnMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICB2YXIgdGFyZ2V0SGFzSXQgPSB0YXJnZXQuaGFzT3duUHJvcGVydHkoa2V5KSxcbiAgICAgICAgICAgIG9wdGlvbnNWYWx1ZVR5cGUgPSB0eXBlb2Ygb3B0aW9uc1trZXldLFxuICAgICAgICAgICAgc2hvdWxkUmVwbGFjZSA9ICF0YXJnZXRIYXNJdCB8fCAodHlwZW9mIHRhcmdldFtrZXldICE9PSBvcHRpb25zVmFsdWVUeXBlKTtcblxuICAgICAgICBpZiAoc2hvdWxkUmVwbGFjZSkge1xuICAgICAgICAgIHRhcmdldFtrZXldID0gb3B0aW9uc1trZXldO1xuICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbnNWYWx1ZVR5cGUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgLy8gZ28gZGVlcCwgZG9uJ3QgY2FyZSBhYm91dCBsb29wcyBoZXJlLCB3ZSBhcmUgc2ltcGxlIEFQSSE6XG4gICAgICAgICAgdGFyZ2V0W2tleV0gPSBtZXJnZSh0YXJnZXRba2V5XSwgb3B0aW9uc1trZXldKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0YXJnZXQ7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgQm9keTogQm9keSxcbiAgVmVjdG9yMmQ6IFZlY3RvcjJkLFxuICBCb2R5M2Q6IEJvZHkzZCxcbiAgVmVjdG9yM2Q6IFZlY3RvcjNkXG59O1xuXG5mdW5jdGlvbiBCb2R5KHgsIHkpIHtcbiAgdGhpcy5wb3MgPSBuZXcgVmVjdG9yMmQoeCwgeSk7XG4gIHRoaXMucHJldlBvcyA9IG5ldyBWZWN0b3IyZCh4LCB5KTtcbiAgdGhpcy5mb3JjZSA9IG5ldyBWZWN0b3IyZCgpO1xuICB0aGlzLnZlbG9jaXR5ID0gbmV3IFZlY3RvcjJkKCk7XG4gIHRoaXMubWFzcyA9IDE7XG59XG5cbkJvZHkucHJvdG90eXBlLnNldFBvc2l0aW9uID0gZnVuY3Rpb24gKHgsIHkpIHtcbiAgdGhpcy5wcmV2UG9zLnggPSB0aGlzLnBvcy54ID0geDtcbiAgdGhpcy5wcmV2UG9zLnkgPSB0aGlzLnBvcy55ID0geTtcbn07XG5cbmZ1bmN0aW9uIFZlY3RvcjJkKHgsIHkpIHtcbiAgaWYgKHggJiYgdHlwZW9mIHggIT09ICdudW1iZXInKSB7XG4gICAgLy8gY291bGQgYmUgYW5vdGhlciB2ZWN0b3JcbiAgICB0aGlzLnggPSB0eXBlb2YgeC54ID09PSAnbnVtYmVyJyA/IHgueCA6IDA7XG4gICAgdGhpcy55ID0gdHlwZW9mIHgueSA9PT0gJ251bWJlcicgPyB4LnkgOiAwO1xuICB9IGVsc2Uge1xuICAgIHRoaXMueCA9IHR5cGVvZiB4ID09PSAnbnVtYmVyJyA/IHggOiAwO1xuICAgIHRoaXMueSA9IHR5cGVvZiB5ID09PSAnbnVtYmVyJyA/IHkgOiAwO1xuICB9XG59XG5cblZlY3RvcjJkLnByb3RvdHlwZS5yZXNldCA9IGZ1bmN0aW9uICgpIHtcbiAgdGhpcy54ID0gdGhpcy55ID0gMDtcbn07XG5cbmZ1bmN0aW9uIEJvZHkzZCh4LCB5LCB6KSB7XG4gIHRoaXMucG9zID0gbmV3IFZlY3RvcjNkKHgsIHksIHopO1xuICB0aGlzLnByZXZQb3MgPSBuZXcgVmVjdG9yM2QoeCwgeSwgeik7XG4gIHRoaXMuZm9yY2UgPSBuZXcgVmVjdG9yM2QoKTtcbiAgdGhpcy52ZWxvY2l0eSA9IG5ldyBWZWN0b3IzZCgpO1xuICB0aGlzLm1hc3MgPSAxO1xufVxuXG5Cb2R5M2QucHJvdG90eXBlLnNldFBvc2l0aW9uID0gZnVuY3Rpb24gKHgsIHksIHopIHtcbiAgdGhpcy5wcmV2UG9zLnggPSB0aGlzLnBvcy54ID0geDtcbiAgdGhpcy5wcmV2UG9zLnkgPSB0aGlzLnBvcy55ID0geTtcbiAgdGhpcy5wcmV2UG9zLnogPSB0aGlzLnBvcy56ID0gejtcbn07XG5cbmZ1bmN0aW9uIFZlY3RvcjNkKHgsIHksIHopIHtcbiAgaWYgKHggJiYgdHlwZW9mIHggIT09ICdudW1iZXInKSB7XG4gICAgLy8gY291bGQgYmUgYW5vdGhlciB2ZWN0b3JcbiAgICB0aGlzLnggPSB0eXBlb2YgeC54ID09PSAnbnVtYmVyJyA/IHgueCA6IDA7XG4gICAgdGhpcy55ID0gdHlwZW9mIHgueSA9PT0gJ251bWJlcicgPyB4LnkgOiAwO1xuICAgIHRoaXMueiA9IHR5cGVvZiB4LnogPT09ICdudW1iZXInID8geC56IDogMDtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLnggPSB0eXBlb2YgeCA9PT0gJ251bWJlcicgPyB4IDogMDtcbiAgICB0aGlzLnkgPSB0eXBlb2YgeSA9PT0gJ251bWJlcicgPyB5IDogMDtcbiAgICB0aGlzLnogPSB0eXBlb2YgeiA9PT0gJ251bWJlcicgPyB6IDogMDtcbiAgfVxufTtcblxuVmVjdG9yM2QucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24gKCkge1xuICB0aGlzLnggPSB0aGlzLnkgPSB0aGlzLnogPSAwO1xufTtcbiIsIi8qKlxyXG4gKiBNYW5hZ2VzIGEgc2ltdWxhdGlvbiBvZiBwaHlzaWNhbCBmb3JjZXMgYWN0aW5nIG9uIGJvZGllcyBhbmQgc3ByaW5ncy5cclxuICovXHJcbm1vZHVsZS5leHBvcnRzID0gcGh5c2ljc1NpbXVsYXRvcjtcclxuXHJcbmZ1bmN0aW9uIHBoeXNpY3NTaW11bGF0b3Ioc2V0dGluZ3MpIHtcclxuICB2YXIgU3ByaW5nID0gcmVxdWlyZSgnLi9saWIvc3ByaW5nJyk7XHJcbiAgdmFyIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcclxuICB2YXIgbWVyZ2UgPSByZXF1aXJlKCduZ3JhcGgubWVyZ2UnKTtcclxuICB2YXIgZXZlbnRpZnkgPSByZXF1aXJlKCduZ3JhcGguZXZlbnRzJyk7XHJcblxyXG4gIHNldHRpbmdzID0gbWVyZ2Uoc2V0dGluZ3MsIHtcclxuICAgICAgLyoqXHJcbiAgICAgICAqIElkZWFsIGxlbmd0aCBmb3IgbGlua3MgKHNwcmluZ3MgaW4gcGh5c2ljYWwgbW9kZWwpLlxyXG4gICAgICAgKi9cclxuICAgICAgc3ByaW5nTGVuZ3RoOiAzMCxcclxuXHJcbiAgICAgIC8qKlxyXG4gICAgICAgKiBIb29rJ3MgbGF3IGNvZWZmaWNpZW50LiAxIC0gc29saWQgc3ByaW5nLlxyXG4gICAgICAgKi9cclxuICAgICAgc3ByaW5nQ29lZmY6IDAuMDAwOCxcclxuXHJcbiAgICAgIC8qKlxyXG4gICAgICAgKiBDb3Vsb21iJ3MgbGF3IGNvZWZmaWNpZW50LiBJdCdzIHVzZWQgdG8gcmVwZWwgbm9kZXMgdGh1cyBzaG91bGQgYmUgbmVnYXRpdmVcclxuICAgICAgICogaWYgeW91IG1ha2UgaXQgcG9zaXRpdmUgbm9kZXMgc3RhcnQgYXR0cmFjdCBlYWNoIG90aGVyIDopLlxyXG4gICAgICAgKi9cclxuICAgICAgZ3Jhdml0eTogLTEuMixcclxuXHJcbiAgICAgIC8qKlxyXG4gICAgICAgKiBUaGV0YSBjb2VmZmljaWVudCBmcm9tIEJhcm5lcyBIdXQgc2ltdWxhdGlvbi4gUmFuZ2VkIGJldHdlZW4gKDAsIDEpLlxyXG4gICAgICAgKiBUaGUgY2xvc2VyIGl0J3MgdG8gMSB0aGUgbW9yZSBub2RlcyBhbGdvcml0aG0gd2lsbCBoYXZlIHRvIGdvIHRocm91Z2guXHJcbiAgICAgICAqIFNldHRpbmcgaXQgdG8gb25lIG1ha2VzIEJhcm5lcyBIdXQgc2ltdWxhdGlvbiBubyBkaWZmZXJlbnQgZnJvbVxyXG4gICAgICAgKiBicnV0ZS1mb3JjZSBmb3JjZXMgY2FsY3VsYXRpb24gKGVhY2ggbm9kZSBpcyBjb25zaWRlcmVkKS5cclxuICAgICAgICovXHJcbiAgICAgIHRoZXRhOiAwLjgsXHJcblxyXG4gICAgICAvKipcclxuICAgICAgICogRHJhZyBmb3JjZSBjb2VmZmljaWVudC4gVXNlZCB0byBzbG93IGRvd24gc3lzdGVtLCB0aHVzIHNob3VsZCBiZSBsZXNzIHRoYW4gMS5cclxuICAgICAgICogVGhlIGNsb3NlciBpdCBpcyB0byAwIHRoZSBsZXNzIHRpZ2h0IHN5c3RlbSB3aWxsIGJlLlxyXG4gICAgICAgKi9cclxuICAgICAgZHJhZ0NvZWZmOiAwLjAyLFxyXG5cclxuICAgICAgLyoqXHJcbiAgICAgICAqIERlZmF1bHQgdGltZSBzdGVwIChkdCkgZm9yIGZvcmNlcyBpbnRlZ3JhdGlvblxyXG4gICAgICAgKi9cclxuICAgICAgdGltZVN0ZXAgOiAyMCxcclxuXHJcbiAgICAgIC8qKlxyXG4gICAgICAgICogTWF4aW11bSBtb3ZlbWVudCBvZiB0aGUgc3lzdGVtIHdoaWNoIGNhbiBiZSBjb25zaWRlcmVkIGFzIHN0YWJpbGl6ZWRcclxuICAgICAgICAqL1xyXG4gICAgICBzdGFibGVUaHJlc2hvbGQ6IDAuMDA5XHJcbiAgfSk7XHJcblxyXG4gIC8vIFdlIGFsbG93IGNsaWVudHMgdG8gb3ZlcnJpZGUgYmFzaWMgZmFjdG9yeSBtZXRob2RzOlxyXG4gIHZhciBjcmVhdGVRdWFkVHJlZSA9IHNldHRpbmdzLmNyZWF0ZVF1YWRUcmVlIHx8IHJlcXVpcmUoJ25ncmFwaC5xdWFkdHJlZWJoJyk7XHJcbiAgdmFyIGNyZWF0ZUJvdW5kcyA9IHNldHRpbmdzLmNyZWF0ZUJvdW5kcyB8fCByZXF1aXJlKCcuL2xpYi9ib3VuZHMnKTtcclxuICB2YXIgY3JlYXRlRHJhZ0ZvcmNlID0gc2V0dGluZ3MuY3JlYXRlRHJhZ0ZvcmNlIHx8IHJlcXVpcmUoJy4vbGliL2RyYWdGb3JjZScpO1xyXG4gIHZhciBjcmVhdGVTcHJpbmdGb3JjZSA9IHNldHRpbmdzLmNyZWF0ZVNwcmluZ0ZvcmNlIHx8IHJlcXVpcmUoJy4vbGliL3NwcmluZ0ZvcmNlJyk7XHJcbiAgdmFyIGludGVncmF0ZSA9IHNldHRpbmdzLmludGVncmF0b3IgfHwgcmVxdWlyZSgnLi9saWIvZXVsZXJJbnRlZ3JhdG9yJyk7XHJcbiAgdmFyIGNyZWF0ZUJvZHkgPSBzZXR0aW5ncy5jcmVhdGVCb2R5IHx8IHJlcXVpcmUoJy4vbGliL2NyZWF0ZUJvZHknKTtcclxuXHJcbiAgdmFyIGJvZGllcyA9IFtdLCAvLyBCb2RpZXMgaW4gdGhpcyBzaW11bGF0aW9uLlxyXG4gICAgICBzcHJpbmdzID0gW10sIC8vIFNwcmluZ3MgaW4gdGhpcyBzaW11bGF0aW9uLlxyXG4gICAgICBxdWFkVHJlZSA9ICBjcmVhdGVRdWFkVHJlZShzZXR0aW5ncyksXHJcbiAgICAgIGJvdW5kcyA9IGNyZWF0ZUJvdW5kcyhib2RpZXMsIHNldHRpbmdzKSxcclxuICAgICAgc3ByaW5nRm9yY2UgPSBjcmVhdGVTcHJpbmdGb3JjZShzZXR0aW5ncyksXHJcbiAgICAgIGRyYWdGb3JjZSA9IGNyZWF0ZURyYWdGb3JjZShzZXR0aW5ncyk7XHJcblxyXG4gIHZhciB0b3RhbE1vdmVtZW50ID0gMDsgLy8gaG93IG11Y2ggbW92ZW1lbnQgd2UgbWFkZSBvbiBsYXN0IHN0ZXBcclxuICB2YXIgbGFzdFN0YWJsZSA9IGZhbHNlOyAvLyBpbmRpY2F0ZXMgd2hldGhlciBzeXN0ZW0gd2FzIHN0YWJsZSBvbiBsYXN0IHN0ZXAoKSBjYWxsXHJcblxyXG4gIHZhciBwdWJsaWNBcGkgPSB7XHJcbiAgICAvKipcclxuICAgICAqIEFycmF5IG9mIGJvZGllcywgcmVnaXN0ZXJlZCB3aXRoIGN1cnJlbnQgc2ltdWxhdG9yXHJcbiAgICAgKlxyXG4gICAgICogTm90ZTogVG8gYWRkIG5ldyBib2R5LCB1c2UgYWRkQm9keSgpIG1ldGhvZC4gVGhpcyBwcm9wZXJ0eSBpcyBvbmx5XHJcbiAgICAgKiBleHBvc2VkIGZvciB0ZXN0aW5nL3BlcmZvcm1hbmNlIHB1cnBvc2VzLlxyXG4gICAgICovXHJcbiAgICBib2RpZXM6IGJvZGllcyxcclxuXHJcbiAgICAvKipcclxuICAgICAqIEFycmF5IG9mIHNwcmluZ3MsIHJlZ2lzdGVyZWQgd2l0aCBjdXJyZW50IHNpbXVsYXRvclxyXG4gICAgICpcclxuICAgICAqIE5vdGU6IFRvIGFkZCBuZXcgc3ByaW5nLCB1c2UgYWRkU3ByaW5nKCkgbWV0aG9kLiBUaGlzIHByb3BlcnR5IGlzIG9ubHlcclxuICAgICAqIGV4cG9zZWQgZm9yIHRlc3RpbmcvcGVyZm9ybWFuY2UgcHVycG9zZXMuXHJcbiAgICAgKi9cclxuICAgIHNwcmluZ3M6IHNwcmluZ3MsXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBSZXR1cm5zIHNldHRpbmdzIHdpdGggd2hpY2ggY3VycmVudCBzaW11bGF0b3Igd2FzIGluaXRpYWxpemVkXHJcbiAgICAgKi9cclxuICAgIHNldHRpbmdzOiBzZXR0aW5ncyxcclxuXHJcbiAgICAvKipcclxuICAgICAqIFBlcmZvcm1zIG9uZSBzdGVwIG9mIGZvcmNlIHNpbXVsYXRpb24uXHJcbiAgICAgKlxyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgc3lzdGVtIGlzIGNvbnNpZGVyZWQgc3RhYmxlOyBGYWxzZSBvdGhlcndpc2UuXHJcbiAgICAgKi9cclxuICAgIHN0ZXA6IGZ1bmN0aW9uICgpIHtcclxuICAgICAgYWNjdW11bGF0ZUZvcmNlcygpO1xyXG4gICAgICB0b3RhbE1vdmVtZW50ID0gaW50ZWdyYXRlKGJvZGllcywgc2V0dGluZ3MudGltZVN0ZXApO1xyXG5cclxuICAgICAgYm91bmRzLnVwZGF0ZSgpO1xyXG4gICAgICB2YXIgc3RhYmxlTm93ID0gdG90YWxNb3ZlbWVudCA8IHNldHRpbmdzLnN0YWJsZVRocmVzaG9sZDtcclxuICAgICAgaWYgKGxhc3RTdGFibGUgIT09IHN0YWJsZU5vdykge1xyXG4gICAgICAgIHB1YmxpY0FwaS5maXJlKCdzdGFibGUnLCBzdGFibGVOb3cpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBsYXN0U3RhYmxlID0gc3RhYmxlTm93O1xyXG5cclxuICAgICAgcmV0dXJuIHN0YWJsZU5vdztcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBBZGRzIGJvZHkgdG8gdGhlIHN5c3RlbVxyXG4gICAgICpcclxuICAgICAqIEBwYXJhbSB7bmdyYXBoLnBoeXNpY3MucHJpbWl0aXZlcy5Cb2R5fSBib2R5IHBoeXNpY2FsIGJvZHlcclxuICAgICAqXHJcbiAgICAgKiBAcmV0dXJucyB7bmdyYXBoLnBoeXNpY3MucHJpbWl0aXZlcy5Cb2R5fSBhZGRlZCBib2R5XHJcbiAgICAgKi9cclxuICAgIGFkZEJvZHk6IGZ1bmN0aW9uIChib2R5KSB7XHJcbiAgICAgIGlmICghYm9keSkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQm9keSBpcyByZXF1aXJlZCcpO1xyXG4gICAgICB9XHJcbiAgICAgIGJvZGllcy5wdXNoKGJvZHkpO1xyXG5cclxuICAgICAgcmV0dXJuIGJvZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQWRkcyBib2R5IHRvIHRoZSBzeXN0ZW0gYXQgZ2l2ZW4gcG9zaXRpb25cclxuICAgICAqXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcG9zIHBvc2l0aW9uIG9mIGEgYm9keVxyXG4gICAgICpcclxuICAgICAqIEByZXR1cm5zIHtuZ3JhcGgucGh5c2ljcy5wcmltaXRpdmVzLkJvZHl9IGFkZGVkIGJvZHlcclxuICAgICAqL1xyXG4gICAgYWRkQm9keUF0OiBmdW5jdGlvbiAocG9zKSB7XHJcbiAgICAgIGlmICghcG9zKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCb2R5IHBvc2l0aW9uIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgIH1cclxuICAgICAgdmFyIGJvZHkgPSBjcmVhdGVCb2R5KHBvcyk7XHJcbiAgICAgIGJvZGllcy5wdXNoKGJvZHkpO1xyXG5cclxuICAgICAgcmV0dXJuIGJvZHk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUmVtb3ZlcyBib2R5IGZyb20gdGhlIHN5c3RlbVxyXG4gICAgICpcclxuICAgICAqIEBwYXJhbSB7bmdyYXBoLnBoeXNpY3MucHJpbWl0aXZlcy5Cb2R5fSBib2R5IHRvIHJlbW92ZVxyXG4gICAgICpcclxuICAgICAqIEByZXR1cm5zIHtCb29sZWFufSB0cnVlIGlmIGJvZHkgZm91bmQgYW5kIHJlbW92ZWQuIGZhbHN5IG90aGVyd2lzZTtcclxuICAgICAqL1xyXG4gICAgcmVtb3ZlQm9keTogZnVuY3Rpb24gKGJvZHkpIHtcclxuICAgICAgaWYgKCFib2R5KSB7IHJldHVybjsgfVxyXG5cclxuICAgICAgdmFyIGlkeCA9IGJvZGllcy5pbmRleE9mKGJvZHkpO1xyXG4gICAgICBpZiAoaWR4IDwgMCkgeyByZXR1cm47IH1cclxuXHJcbiAgICAgIGJvZGllcy5zcGxpY2UoaWR4LCAxKTtcclxuICAgICAgaWYgKGJvZGllcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICBib3VuZHMucmVzZXQoKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBBZGRzIGEgc3ByaW5nIHRvIHRoaXMgc2ltdWxhdGlvbi5cclxuICAgICAqXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSAtIGEgaGFuZGxlIGZvciBhIHNwcmluZy4gSWYgeW91IHdhbnQgdG8gbGF0ZXIgcmVtb3ZlXHJcbiAgICAgKiBzcHJpbmcgcGFzcyBpdCB0byByZW1vdmVTcHJpbmcoKSBtZXRob2QuXHJcbiAgICAgKi9cclxuICAgIGFkZFNwcmluZzogZnVuY3Rpb24gKGJvZHkxLCBib2R5Miwgc3ByaW5nTGVuZ3RoLCBzcHJpbmdXZWlnaHQsIHNwcmluZ0NvZWZmaWNpZW50KSB7XHJcbiAgICAgIGlmICghYm9keTEgfHwgIWJvZHkyKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgYWRkIG51bGwgc3ByaW5nIHRvIGZvcmNlIHNpbXVsYXRvcicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAodHlwZW9mIHNwcmluZ0xlbmd0aCAhPT0gJ251bWJlcicpIHtcclxuICAgICAgICBzcHJpbmdMZW5ndGggPSAtMTsgLy8gYXNzdW1lIGdsb2JhbCBjb25maWd1cmF0aW9uXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHZhciBzcHJpbmcgPSBuZXcgU3ByaW5nKGJvZHkxLCBib2R5Miwgc3ByaW5nTGVuZ3RoLCBzcHJpbmdDb2VmZmljaWVudCA+PSAwID8gc3ByaW5nQ29lZmZpY2llbnQgOiAtMSwgc3ByaW5nV2VpZ2h0KTtcclxuICAgICAgc3ByaW5ncy5wdXNoKHNwcmluZyk7XHJcblxyXG4gICAgICAvLyBUT0RPOiBjb3VsZCBtYXJrIHNpbXVsYXRvciBhcyBkaXJ0eS5cclxuICAgICAgcmV0dXJuIHNwcmluZztcclxuICAgIH0sXHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBSZXR1cm5zIGFtb3VudCBvZiBtb3ZlbWVudCBwZXJmb3JtZWQgb24gbGFzdCBzdGVwKCkgY2FsbFxyXG4gICAgICovXHJcbiAgICBnZXRUb3RhbE1vdmVtZW50OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgIHJldHVybiB0b3RhbE1vdmVtZW50O1xyXG4gICAgfSxcclxuXHJcbiAgICAvKipcclxuICAgICAqIFJlbW92ZXMgc3ByaW5nIGZyb20gdGhlIHN5c3RlbVxyXG4gICAgICpcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBzcHJpbmcgdG8gcmVtb3ZlLiBTcHJpbmcgaXMgYW4gb2JqZWN0IHJldHVybmVkIGJ5IGFkZFNwcmluZ1xyXG4gICAgICpcclxuICAgICAqIEByZXR1cm5zIHtCb29sZWFufSB0cnVlIGlmIHNwcmluZyBmb3VuZCBhbmQgcmVtb3ZlZC4gZmFsc3kgb3RoZXJ3aXNlO1xyXG4gICAgICovXHJcbiAgICByZW1vdmVTcHJpbmc6IGZ1bmN0aW9uIChzcHJpbmcpIHtcclxuICAgICAgaWYgKCFzcHJpbmcpIHsgcmV0dXJuOyB9XHJcbiAgICAgIHZhciBpZHggPSBzcHJpbmdzLmluZGV4T2Yoc3ByaW5nKTtcclxuICAgICAgaWYgKGlkeCA+IC0xKSB7XHJcbiAgICAgICAgc3ByaW5ncy5zcGxpY2UoaWR4LCAxKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG4gICAgfSxcclxuXHJcbiAgICBnZXRCZXN0TmV3Qm9keVBvc2l0aW9uOiBmdW5jdGlvbiAobmVpZ2hib3JzKSB7XHJcbiAgICAgIHJldHVybiBib3VuZHMuZ2V0QmVzdE5ld1Bvc2l0aW9uKG5laWdoYm9ycyk7XHJcbiAgICB9LFxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUmV0dXJucyBib3VuZGluZyBib3ggd2hpY2ggY292ZXJzIGFsbCBib2RpZXNcclxuICAgICAqL1xyXG4gICAgZ2V0QkJveDogZnVuY3Rpb24gKCkge1xyXG4gICAgICByZXR1cm4gYm91bmRzLmJveDtcclxuICAgIH0sXHJcblxyXG4gICAgZ3Jhdml0eTogZnVuY3Rpb24gKHZhbHVlKSB7XHJcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgc2V0dGluZ3MuZ3Jhdml0eSA9IHZhbHVlO1xyXG4gICAgICAgIHF1YWRUcmVlLm9wdGlvbnMoe2dyYXZpdHk6IHZhbHVlfSk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIHNldHRpbmdzLmdyYXZpdHk7XHJcbiAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgdGhldGE6IGZ1bmN0aW9uICh2YWx1ZSkge1xyXG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHNldHRpbmdzLnRoZXRhID0gdmFsdWU7XHJcbiAgICAgICAgcXVhZFRyZWUub3B0aW9ucyh7dGhldGE6IHZhbHVlfSk7XHJcbiAgICAgICAgcmV0dXJuIHRoaXM7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmV0dXJuIHNldHRpbmdzLnRoZXRhO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgLy8gYWxsb3cgc2V0dGluZ3MgbW9kaWZpY2F0aW9uIHZpYSBwdWJsaWMgQVBJOlxyXG4gIGV4cG9zZShzZXR0aW5ncywgcHVibGljQXBpKTtcclxuICBldmVudGlmeShwdWJsaWNBcGkpO1xyXG5cclxuICByZXR1cm4gcHVibGljQXBpO1xyXG5cclxuICBmdW5jdGlvbiBhY2N1bXVsYXRlRm9yY2VzKCkge1xyXG4gICAgLy8gQWNjdW11bGF0ZSBmb3JjZXMgYWN0aW5nIG9uIGJvZGllcy5cclxuICAgIHZhciBib2R5LFxyXG4gICAgICAgIGkgPSBib2RpZXMubGVuZ3RoO1xyXG5cclxuICAgIGlmIChpKSB7XHJcbiAgICAgIC8vIG9ubHkgYWRkIGJvZGllcyBpZiB0aGVyZSB0aGUgYXJyYXkgaXMgbm90IGVtcHR5OlxyXG4gICAgICBxdWFkVHJlZS5pbnNlcnRCb2RpZXMoYm9kaWVzKTsgLy8gcGVyZm9ybWFuY2U6IE8obiAqIGxvZyBuKVxyXG4gICAgICB3aGlsZSAoaS0tKSB7XHJcbiAgICAgICAgYm9keSA9IGJvZGllc1tpXTtcclxuICAgICAgICAvLyBJZiBib2R5IGlzIHBpbm5lZCB0aGVyZSBpcyBubyBwb2ludCB1cGRhdGluZyBpdHMgZm9yY2VzIC0gaXQgc2hvdWxkXHJcbiAgICAgICAgLy8gbmV2ZXIgbW92ZTpcclxuICAgICAgICBpZiAoIWJvZHkuaXNQaW5uZWQpIHtcclxuICAgICAgICAgIGJvZHkuZm9yY2UucmVzZXQoKTtcclxuXHJcbiAgICAgICAgICBxdWFkVHJlZS51cGRhdGVCb2R5Rm9yY2UoYm9keSk7XHJcbiAgICAgICAgICBkcmFnRm9yY2UudXBkYXRlKGJvZHkpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGkgPSBzcHJpbmdzLmxlbmd0aDtcclxuICAgIHdoaWxlKGktLSkge1xyXG4gICAgICBzcHJpbmdGb3JjZS51cGRhdGUoc3ByaW5nc1tpXSk7XHJcbiAgICB9XHJcbiAgfVxyXG59O1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChib2RpZXMsIHNldHRpbmdzKSB7XHJcbiAgdmFyIHJhbmRvbSA9IHJlcXVpcmUoJ25ncmFwaC5yYW5kb20nKS5yYW5kb20oNDIpO1xyXG4gIHZhciBib3VuZGluZ0JveCA9ICB7IHgxOiAwLCB5MTogMCwgeDI6IDAsIHkyOiAwIH07XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBib3g6IGJvdW5kaW5nQm94LFxyXG5cclxuICAgIHVwZGF0ZTogdXBkYXRlQm91bmRpbmdCb3gsXHJcblxyXG4gICAgcmVzZXQgOiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgIGJvdW5kaW5nQm94LngxID0gYm91bmRpbmdCb3gueTEgPSAwO1xyXG4gICAgICBib3VuZGluZ0JveC54MiA9IGJvdW5kaW5nQm94LnkyID0gMDtcclxuICAgIH0sXHJcblxyXG4gICAgZ2V0QmVzdE5ld1Bvc2l0aW9uOiBmdW5jdGlvbiAobmVpZ2hib3JzKSB7XHJcbiAgICAgIHZhciBncmFwaFJlY3QgPSBib3VuZGluZ0JveDtcclxuXHJcbiAgICAgIHZhciBiYXNlWCA9IDAsIGJhc2VZID0gMDtcclxuXHJcbiAgICAgIGlmIChuZWlnaGJvcnMubGVuZ3RoKSB7XHJcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuZWlnaGJvcnMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgIGJhc2VYICs9IG5laWdoYm9yc1tpXS5wb3MueDtcclxuICAgICAgICAgIGJhc2VZICs9IG5laWdoYm9yc1tpXS5wb3MueTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGJhc2VYIC89IG5laWdoYm9ycy5sZW5ndGg7XHJcbiAgICAgICAgYmFzZVkgLz0gbmVpZ2hib3JzLmxlbmd0aDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBiYXNlWCA9IChncmFwaFJlY3QueDEgKyBncmFwaFJlY3QueDIpIC8gMjtcclxuICAgICAgICBiYXNlWSA9IChncmFwaFJlY3QueTEgKyBncmFwaFJlY3QueTIpIC8gMjtcclxuICAgICAgfVxyXG5cclxuICAgICAgdmFyIHNwcmluZ0xlbmd0aCA9IHNldHRpbmdzLnNwcmluZ0xlbmd0aDtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICB4OiBiYXNlWCArIHJhbmRvbS5uZXh0KHNwcmluZ0xlbmd0aCkgLSBzcHJpbmdMZW5ndGggLyAyLFxyXG4gICAgICAgIHk6IGJhc2VZICsgcmFuZG9tLm5leHQoc3ByaW5nTGVuZ3RoKSAtIHNwcmluZ0xlbmd0aCAvIDJcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBmdW5jdGlvbiB1cGRhdGVCb3VuZGluZ0JveCgpIHtcclxuICAgIHZhciBpID0gYm9kaWVzLmxlbmd0aDtcclxuICAgIGlmIChpID09PSAwKSB7IHJldHVybjsgfSAvLyBkb24ndCBoYXZlIHRvIHdvcnkgaGVyZS5cclxuXHJcbiAgICB2YXIgeDEgPSBOdW1iZXIuTUFYX1ZBTFVFLFxyXG4gICAgICAgIHkxID0gTnVtYmVyLk1BWF9WQUxVRSxcclxuICAgICAgICB4MiA9IE51bWJlci5NSU5fVkFMVUUsXHJcbiAgICAgICAgeTIgPSBOdW1iZXIuTUlOX1ZBTFVFO1xyXG5cclxuICAgIHdoaWxlKGktLSkge1xyXG4gICAgICAvLyB0aGlzIGlzIE8obiksIGNvdWxkIGl0IGJlIGRvbmUgZmFzdGVyIHdpdGggcXVhZHRyZWU/XHJcbiAgICAgIC8vIGhvdyBhYm91dCBwaW5uZWQgbm9kZXM/XHJcbiAgICAgIHZhciBib2R5ID0gYm9kaWVzW2ldO1xyXG4gICAgICBpZiAoYm9keS5pc1Bpbm5lZCkge1xyXG4gICAgICAgIGJvZHkucG9zLnggPSBib2R5LnByZXZQb3MueDtcclxuICAgICAgICBib2R5LnBvcy55ID0gYm9keS5wcmV2UG9zLnk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgYm9keS5wcmV2UG9zLnggPSBib2R5LnBvcy54O1xyXG4gICAgICAgIGJvZHkucHJldlBvcy55ID0gYm9keS5wb3MueTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoYm9keS5wb3MueCA8IHgxKSB7XHJcbiAgICAgICAgeDEgPSBib2R5LnBvcy54O1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChib2R5LnBvcy54ID4geDIpIHtcclxuICAgICAgICB4MiA9IGJvZHkucG9zLng7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKGJvZHkucG9zLnkgPCB5MSkge1xyXG4gICAgICAgIHkxID0gYm9keS5wb3MueTtcclxuICAgICAgfVxyXG4gICAgICBpZiAoYm9keS5wb3MueSA+IHkyKSB7XHJcbiAgICAgICAgeTIgPSBib2R5LnBvcy55O1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgYm91bmRpbmdCb3gueDEgPSB4MTtcclxuICAgIGJvdW5kaW5nQm94LngyID0geDI7XHJcbiAgICBib3VuZGluZ0JveC55MSA9IHkxO1xyXG4gICAgYm91bmRpbmdCb3gueTIgPSB5MjtcclxuICB9XHJcbn1cclxuIiwidmFyIHBoeXNpY3MgPSByZXF1aXJlKCduZ3JhcGgucGh5c2ljcy5wcmltaXRpdmVzJyk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHBvcykge1xyXG4gIHJldHVybiBuZXcgcGh5c2ljcy5Cb2R5KHBvcyk7XHJcbn1cclxuIiwiLyoqXHJcbiAqIFJlcHJlc2VudHMgZHJhZyBmb3JjZSwgd2hpY2ggcmVkdWNlcyBmb3JjZSB2YWx1ZSBvbiBlYWNoIHN0ZXAgYnkgZ2l2ZW5cclxuICogY29lZmZpY2llbnQuXHJcbiAqXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIGZvciB0aGUgZHJhZyBmb3JjZVxyXG4gKiBAcGFyYW0ge051bWJlcj19IG9wdGlvbnMuZHJhZ0NvZWZmIGRyYWcgZm9yY2UgY29lZmZpY2llbnQuIDAuMSBieSBkZWZhdWx0XHJcbiAqL1xyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XHJcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyksXHJcbiAgICAgIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcclxuXHJcbiAgb3B0aW9ucyA9IG1lcmdlKG9wdGlvbnMsIHtcclxuICAgIGRyYWdDb2VmZjogMC4wMlxyXG4gIH0pO1xyXG5cclxuICB2YXIgYXBpID0ge1xyXG4gICAgdXBkYXRlIDogZnVuY3Rpb24gKGJvZHkpIHtcclxuICAgICAgYm9keS5mb3JjZS54IC09IG9wdGlvbnMuZHJhZ0NvZWZmICogYm9keS52ZWxvY2l0eS54O1xyXG4gICAgICBib2R5LmZvcmNlLnkgLT0gb3B0aW9ucy5kcmFnQ29lZmYgKiBib2R5LnZlbG9jaXR5Lnk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgLy8gbGV0IGVhc3kgYWNjZXNzIHRvIGRyYWdDb2VmZjpcclxuICBleHBvc2Uob3B0aW9ucywgYXBpLCBbJ2RyYWdDb2VmZiddKTtcclxuXHJcbiAgcmV0dXJuIGFwaTtcclxufTtcclxuIiwiLyoqXHJcbiAqIFBlcmZvcm1zIGZvcmNlcyBpbnRlZ3JhdGlvbiwgdXNpbmcgZ2l2ZW4gdGltZXN0ZXAuIFVzZXMgRXVsZXIgbWV0aG9kIHRvIHNvbHZlXHJcbiAqIGRpZmZlcmVudGlhbCBlcXVhdGlvbiAoaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9FdWxlcl9tZXRob2QgKS5cclxuICpcclxuICogQHJldHVybnMge051bWJlcn0gc3F1YXJlZCBkaXN0YW5jZSBvZiB0b3RhbCBwb3NpdGlvbiB1cGRhdGVzLlxyXG4gKi9cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gaW50ZWdyYXRlO1xyXG5cclxuZnVuY3Rpb24gaW50ZWdyYXRlKGJvZGllcywgdGltZVN0ZXApIHtcclxuICB2YXIgZHggPSAwLCB0eCA9IDAsXHJcbiAgICAgIGR5ID0gMCwgdHkgPSAwLFxyXG4gICAgICBpLFxyXG4gICAgICBtYXggPSBib2RpZXMubGVuZ3RoO1xyXG5cclxuICBpZiAobWF4ID09PSAwKSB7XHJcbiAgICByZXR1cm4gMDtcclxuICB9XHJcblxyXG4gIGZvciAoaSA9IDA7IGkgPCBtYXg7ICsraSkge1xyXG4gICAgdmFyIGJvZHkgPSBib2RpZXNbaV0sXHJcbiAgICAgICAgY29lZmYgPSB0aW1lU3RlcCAvIGJvZHkubWFzcztcclxuXHJcbiAgICBib2R5LnZlbG9jaXR5LnggKz0gY29lZmYgKiBib2R5LmZvcmNlLng7XHJcbiAgICBib2R5LnZlbG9jaXR5LnkgKz0gY29lZmYgKiBib2R5LmZvcmNlLnk7XHJcbiAgICB2YXIgdnggPSBib2R5LnZlbG9jaXR5LngsXHJcbiAgICAgICAgdnkgPSBib2R5LnZlbG9jaXR5LnksXHJcbiAgICAgICAgdiA9IE1hdGguc3FydCh2eCAqIHZ4ICsgdnkgKiB2eSk7XHJcblxyXG4gICAgaWYgKHYgPiAxKSB7XHJcbiAgICAgIGJvZHkudmVsb2NpdHkueCA9IHZ4IC8gdjtcclxuICAgICAgYm9keS52ZWxvY2l0eS55ID0gdnkgLyB2O1xyXG4gICAgfVxyXG5cclxuICAgIGR4ID0gdGltZVN0ZXAgKiBib2R5LnZlbG9jaXR5Lng7XHJcbiAgICBkeSA9IHRpbWVTdGVwICogYm9keS52ZWxvY2l0eS55O1xyXG5cclxuICAgIGJvZHkucG9zLnggKz0gZHg7XHJcbiAgICBib2R5LnBvcy55ICs9IGR5O1xyXG5cclxuICAgIHR4ICs9IE1hdGguYWJzKGR4KTsgdHkgKz0gTWF0aC5hYnMoZHkpO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuICh0eCAqIHR4ICsgdHkgKiB0eSkvbWF4O1xyXG59XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gU3ByaW5nO1xyXG5cclxuLyoqXHJcbiAqIFJlcHJlc2VudHMgYSBwaHlzaWNhbCBzcHJpbmcuIFNwcmluZyBjb25uZWN0cyB0d28gYm9kaWVzLCBoYXMgcmVzdCBsZW5ndGhcclxuICogc3RpZmZuZXNzIGNvZWZmaWNpZW50IGFuZCBvcHRpb25hbCB3ZWlnaHRcclxuICovXHJcbmZ1bmN0aW9uIFNwcmluZyhmcm9tQm9keSwgdG9Cb2R5LCBsZW5ndGgsIGNvZWZmLCB3ZWlnaHQpIHtcclxuICAgIHRoaXMuZnJvbSA9IGZyb21Cb2R5O1xyXG4gICAgdGhpcy50byA9IHRvQm9keTtcclxuICAgIHRoaXMubGVuZ3RoID0gbGVuZ3RoO1xyXG4gICAgdGhpcy5jb2VmZiA9IGNvZWZmO1xyXG5cclxuICAgIHRoaXMud2VpZ2h0ID0gdHlwZW9mIHdlaWdodCA9PT0gJ251bWJlcicgPyB3ZWlnaHQgOiAxO1xyXG59O1xyXG4iLCIvKipcclxuICogUmVwcmVzZW50cyBzcHJpbmcgZm9yY2UsIHdoaWNoIHVwZGF0ZXMgZm9yY2VzIGFjdGluZyBvbiB0d28gYm9kaWVzLCBjb25udGVjdGVkXHJcbiAqIGJ5IGEgc3ByaW5nLlxyXG4gKlxyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyBmb3IgdGhlIHNwcmluZyBmb3JjZVxyXG4gKiBAcGFyYW0ge051bWJlcj19IG9wdGlvbnMuc3ByaW5nQ29lZmYgc3ByaW5nIGZvcmNlIGNvZWZmaWNpZW50LlxyXG4gKiBAcGFyYW0ge051bWJlcj19IG9wdGlvbnMuc3ByaW5nTGVuZ3RoIGRlc2lyZWQgbGVuZ3RoIG9mIGEgc3ByaW5nIGF0IHJlc3QuXHJcbiAqL1xyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XHJcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyk7XHJcbiAgdmFyIHJhbmRvbSA9IHJlcXVpcmUoJ25ncmFwaC5yYW5kb20nKS5yYW5kb20oNDIpO1xyXG4gIHZhciBleHBvc2UgPSByZXF1aXJlKCduZ3JhcGguZXhwb3NlJyk7XHJcblxyXG4gIG9wdGlvbnMgPSBtZXJnZShvcHRpb25zLCB7XHJcbiAgICBzcHJpbmdDb2VmZjogMC4wMDAyLFxyXG4gICAgc3ByaW5nTGVuZ3RoOiA4MFxyXG4gIH0pO1xyXG5cclxuICB2YXIgYXBpID0ge1xyXG4gICAgLyoqXHJcbiAgICAgKiBVcHNhdGVzIGZvcmNlcyBhY3Rpbmcgb24gYSBzcHJpbmdcclxuICAgICAqL1xyXG4gICAgdXBkYXRlIDogZnVuY3Rpb24gKHNwcmluZykge1xyXG4gICAgICB2YXIgYm9keTEgPSBzcHJpbmcuZnJvbSxcclxuICAgICAgICAgIGJvZHkyID0gc3ByaW5nLnRvLFxyXG4gICAgICAgICAgbGVuZ3RoID0gc3ByaW5nLmxlbmd0aCA8IDAgPyBvcHRpb25zLnNwcmluZ0xlbmd0aCA6IHNwcmluZy5sZW5ndGgsXHJcbiAgICAgICAgICBkeCA9IGJvZHkyLnBvcy54IC0gYm9keTEucG9zLngsXHJcbiAgICAgICAgICBkeSA9IGJvZHkyLnBvcy55IC0gYm9keTEucG9zLnksXHJcbiAgICAgICAgICByID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcclxuXHJcbiAgICAgIGlmIChyID09PSAwKSB7XHJcbiAgICAgICAgICBkeCA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xyXG4gICAgICAgICAgZHkgPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcclxuICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB2YXIgZCA9IHIgLSBsZW5ndGg7XHJcbiAgICAgIHZhciBjb2VmZiA9ICgoIXNwcmluZy5jb2VmZiB8fCBzcHJpbmcuY29lZmYgPCAwKSA/IG9wdGlvbnMuc3ByaW5nQ29lZmYgOiBzcHJpbmcuY29lZmYpICogZCAvIHIgKiBzcHJpbmcud2VpZ2h0O1xyXG5cclxuICAgICAgYm9keTEuZm9yY2UueCArPSBjb2VmZiAqIGR4O1xyXG4gICAgICBib2R5MS5mb3JjZS55ICs9IGNvZWZmICogZHk7XHJcblxyXG4gICAgICBib2R5Mi5mb3JjZS54IC09IGNvZWZmICogZHg7XHJcbiAgICAgIGJvZHkyLmZvcmNlLnkgLT0gY29lZmYgKiBkeTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICBleHBvc2Uob3B0aW9ucywgYXBpLCBbJ3NwcmluZ0NvZWZmJywgJ3NwcmluZ0xlbmd0aCddKTtcclxuICByZXR1cm4gYXBpO1xyXG59XHJcbiIsIi8qKlxuICogTWFuYWdlcyBhIHNpbXVsYXRpb24gb2YgcGh5c2ljYWwgZm9yY2VzIGFjdGluZyBvbiBib2RpZXMgYW5kIHNwcmluZ3MuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gcGh5c2ljc1NpbXVsYXRvcjtcblxuZnVuY3Rpb24gcGh5c2ljc1NpbXVsYXRvcihzZXR0aW5ncykge1xuICB2YXIgU3ByaW5nID0gcmVxdWlyZSgnLi9saWIvc3ByaW5nJyk7XG4gIHZhciBleHBvc2UgPSByZXF1aXJlKCduZ3JhcGguZXhwb3NlJyk7XG4gIHZhciBtZXJnZSA9IHJlcXVpcmUoJ25ncmFwaC5tZXJnZScpO1xuICB2YXIgZXZlbnRpZnkgPSByZXF1aXJlKCduZ3JhcGguZXZlbnRzJyk7XG5cbiAgc2V0dGluZ3MgPSBtZXJnZShzZXR0aW5ncywge1xuICAgICAgLyoqXG4gICAgICAgKiBJZGVhbCBsZW5ndGggZm9yIGxpbmtzIChzcHJpbmdzIGluIHBoeXNpY2FsIG1vZGVsKS5cbiAgICAgICAqL1xuICAgICAgc3ByaW5nTGVuZ3RoOiAzMCxcblxuICAgICAgLyoqXG4gICAgICAgKiBIb29rJ3MgbGF3IGNvZWZmaWNpZW50LiAxIC0gc29saWQgc3ByaW5nLlxuICAgICAgICovXG4gICAgICBzcHJpbmdDb2VmZjogMC4wMDA4LFxuXG4gICAgICAvKipcbiAgICAgICAqIENvdWxvbWIncyBsYXcgY29lZmZpY2llbnQuIEl0J3MgdXNlZCB0byByZXBlbCBub2RlcyB0aHVzIHNob3VsZCBiZSBuZWdhdGl2ZVxuICAgICAgICogaWYgeW91IG1ha2UgaXQgcG9zaXRpdmUgbm9kZXMgc3RhcnQgYXR0cmFjdCBlYWNoIG90aGVyIDopLlxuICAgICAgICovXG4gICAgICBncmF2aXR5OiAtMS4yLFxuXG4gICAgICAvKipcbiAgICAgICAqIFRoZXRhIGNvZWZmaWNpZW50IGZyb20gQmFybmVzIEh1dCBzaW11bGF0aW9uLiBSYW5nZWQgYmV0d2VlbiAoMCwgMSkuXG4gICAgICAgKiBUaGUgY2xvc2VyIGl0J3MgdG8gMSB0aGUgbW9yZSBub2RlcyBhbGdvcml0aG0gd2lsbCBoYXZlIHRvIGdvIHRocm91Z2guXG4gICAgICAgKiBTZXR0aW5nIGl0IHRvIG9uZSBtYWtlcyBCYXJuZXMgSHV0IHNpbXVsYXRpb24gbm8gZGlmZmVyZW50IGZyb21cbiAgICAgICAqIGJydXRlLWZvcmNlIGZvcmNlcyBjYWxjdWxhdGlvbiAoZWFjaCBub2RlIGlzIGNvbnNpZGVyZWQpLlxuICAgICAgICovXG4gICAgICB0aGV0YTogMC44LFxuXG4gICAgICAvKipcbiAgICAgICAqIERyYWcgZm9yY2UgY29lZmZpY2llbnQuIFVzZWQgdG8gc2xvdyBkb3duIHN5c3RlbSwgdGh1cyBzaG91bGQgYmUgbGVzcyB0aGFuIDEuXG4gICAgICAgKiBUaGUgY2xvc2VyIGl0IGlzIHRvIDAgdGhlIGxlc3MgdGlnaHQgc3lzdGVtIHdpbGwgYmUuXG4gICAgICAgKi9cbiAgICAgIGRyYWdDb2VmZjogMC4wMixcblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZhdWx0IHRpbWUgc3RlcCAoZHQpIGZvciBmb3JjZXMgaW50ZWdyYXRpb25cbiAgICAgICAqL1xuICAgICAgdGltZVN0ZXAgOiAyMCxcblxuICAgICAgLyoqXG4gICAgICAgICogTWF4aW11bSBtb3ZlbWVudCBvZiB0aGUgc3lzdGVtIHdoaWNoIGNhbiBiZSBjb25zaWRlcmVkIGFzIHN0YWJpbGl6ZWRcbiAgICAgICAgKi9cbiAgICAgIHN0YWJsZVRocmVzaG9sZDogMC4wMDlcbiAgfSk7XG5cbiAgLy8gV2UgYWxsb3cgY2xpZW50cyB0byBvdmVycmlkZSBiYXNpYyBmYWN0b3J5IG1ldGhvZHM6XG4gIHZhciBjcmVhdGVRdWFkVHJlZSA9IHNldHRpbmdzLmNyZWF0ZVF1YWRUcmVlIHx8IHJlcXVpcmUoJ25ncmFwaC5xdWFkdHJlZWJoJyk7XG4gIHZhciBjcmVhdGVCb3VuZHMgPSBzZXR0aW5ncy5jcmVhdGVCb3VuZHMgfHwgcmVxdWlyZSgnLi9saWIvYm91bmRzJyk7XG4gIHZhciBjcmVhdGVEcmFnRm9yY2UgPSBzZXR0aW5ncy5jcmVhdGVEcmFnRm9yY2UgfHwgcmVxdWlyZSgnLi9saWIvZHJhZ0ZvcmNlJyk7XG4gIHZhciBjcmVhdGVTcHJpbmdGb3JjZSA9IHNldHRpbmdzLmNyZWF0ZVNwcmluZ0ZvcmNlIHx8IHJlcXVpcmUoJy4vbGliL3NwcmluZ0ZvcmNlJyk7XG4gIHZhciBpbnRlZ3JhdGUgPSBzZXR0aW5ncy5pbnRlZ3JhdG9yIHx8IHJlcXVpcmUoJy4vbGliL2V1bGVySW50ZWdyYXRvcicpO1xuICB2YXIgY3JlYXRlQm9keSA9IHNldHRpbmdzLmNyZWF0ZUJvZHkgfHwgcmVxdWlyZSgnLi9saWIvY3JlYXRlQm9keScpO1xuXG4gIHZhciBib2RpZXMgPSBbXSwgLy8gQm9kaWVzIGluIHRoaXMgc2ltdWxhdGlvbi5cbiAgICAgIHNwcmluZ3MgPSBbXSwgLy8gU3ByaW5ncyBpbiB0aGlzIHNpbXVsYXRpb24uXG4gICAgICBxdWFkVHJlZSA9ICBjcmVhdGVRdWFkVHJlZShzZXR0aW5ncyksXG4gICAgICBib3VuZHMgPSBjcmVhdGVCb3VuZHMoYm9kaWVzLCBzZXR0aW5ncyksXG4gICAgICBzcHJpbmdGb3JjZSA9IGNyZWF0ZVNwcmluZ0ZvcmNlKHNldHRpbmdzKSxcbiAgICAgIGRyYWdGb3JjZSA9IGNyZWF0ZURyYWdGb3JjZShzZXR0aW5ncyk7XG5cbiAgdmFyIHRvdGFsTW92ZW1lbnQgPSAwOyAvLyBob3cgbXVjaCBtb3ZlbWVudCB3ZSBtYWRlIG9uIGxhc3Qgc3RlcFxuICB2YXIgbGFzdFN0YWJsZSA9IGZhbHNlOyAvLyBpbmRpY2F0ZXMgd2hldGhlciBzeXN0ZW0gd2FzIHN0YWJsZSBvbiBsYXN0IHN0ZXAoKSBjYWxsXG5cbiAgdmFyIHB1YmxpY0FwaSA9IHtcbiAgICAvKipcbiAgICAgKiBBcnJheSBvZiBib2RpZXMsIHJlZ2lzdGVyZWQgd2l0aCBjdXJyZW50IHNpbXVsYXRvclxuICAgICAqXG4gICAgICogTm90ZTogVG8gYWRkIG5ldyBib2R5LCB1c2UgYWRkQm9keSgpIG1ldGhvZC4gVGhpcyBwcm9wZXJ0eSBpcyBvbmx5XG4gICAgICogZXhwb3NlZCBmb3IgdGVzdGluZy9wZXJmb3JtYW5jZSBwdXJwb3Nlcy5cbiAgICAgKi9cbiAgICBib2RpZXM6IGJvZGllcyxcblxuICAgIC8qKlxuICAgICAqIEFycmF5IG9mIHNwcmluZ3MsIHJlZ2lzdGVyZWQgd2l0aCBjdXJyZW50IHNpbXVsYXRvclxuICAgICAqXG4gICAgICogTm90ZTogVG8gYWRkIG5ldyBzcHJpbmcsIHVzZSBhZGRTcHJpbmcoKSBtZXRob2QuIFRoaXMgcHJvcGVydHkgaXMgb25seVxuICAgICAqIGV4cG9zZWQgZm9yIHRlc3RpbmcvcGVyZm9ybWFuY2UgcHVycG9zZXMuXG4gICAgICovXG4gICAgc3ByaW5nczogc3ByaW5ncyxcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgc2V0dGluZ3Mgd2l0aCB3aGljaCBjdXJyZW50IHNpbXVsYXRvciB3YXMgaW5pdGlhbGl6ZWRcbiAgICAgKi9cbiAgICBzZXR0aW5nczogc2V0dGluZ3MsXG5cbiAgICAvKipcbiAgICAgKiBQZXJmb3JtcyBvbmUgc3RlcCBvZiBmb3JjZSBzaW11bGF0aW9uLlxuICAgICAqXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IHRydWUgaWYgc3lzdGVtIGlzIGNvbnNpZGVyZWQgc3RhYmxlOyBGYWxzZSBvdGhlcndpc2UuXG4gICAgICovXG4gICAgc3RlcDogZnVuY3Rpb24gKGZpbmFsKSB7XG4gICAgICBhY2N1bXVsYXRlRm9yY2VzKCk7XG4gICAgICB0b3RhbE1vdmVtZW50ID0gaW50ZWdyYXRlKGJvZGllcywgc2V0dGluZ3MudGltZVN0ZXApO1xuXG5cbiAgICAgIHZhciBzdGFibGVOb3cgPSB0b3RhbE1vdmVtZW50IDwgc2V0dGluZ3Muc3RhYmxlVGhyZXNob2xkO1xuICAgICAgaWYgKGxhc3RTdGFibGUgIT09IHN0YWJsZU5vdyB8fCBmaW5hbCkge1xuICAgICAgICBib3VuZHMudXBkYXRlKCk7XG4gICAgICAgIHB1YmxpY0FwaS5maXJlKCdzdGFibGUnLCBzdGFibGVOb3cpO1xuICAgICAgfVxuXG4gICAgICBsYXN0U3RhYmxlID0gc3RhYmxlTm93O1xuXG4gICAgICByZXR1cm4gc3RhYmxlTm93O1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBBZGRzIGJvZHkgdG8gdGhlIHN5c3RlbVxuICAgICAqXG4gICAgICogQHBhcmFtIHtuZ3JhcGgucGh5c2ljcy5wcmltaXRpdmVzLkJvZHl9IGJvZHkgcGh5c2ljYWwgYm9keVxuICAgICAqXG4gICAgICogQHJldHVybnMge25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMuQm9keX0gYWRkZWQgYm9keVxuICAgICAqL1xuICAgIGFkZEJvZHk6IGZ1bmN0aW9uIChib2R5KSB7XG4gICAgICBpZiAoIWJvZHkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCb2R5IGlzIHJlcXVpcmVkJyk7XG4gICAgICB9XG4gICAgICBib2RpZXMucHVzaChib2R5KTtcblxuICAgICAgcmV0dXJuIGJvZHk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEFkZHMgYm9keSB0byB0aGUgc3lzdGVtIGF0IGdpdmVuIHBvc2l0aW9uXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcG9zIHBvc2l0aW9uIG9mIGEgYm9keVxuICAgICAqXG4gICAgICogQHJldHVybnMge25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMuQm9keX0gYWRkZWQgYm9keVxuICAgICAqL1xuICAgIGFkZEJvZHlBdDogZnVuY3Rpb24gKHBvcykge1xuICAgICAgaWYgKCFwb3MpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdCb2R5IHBvc2l0aW9uIGlzIHJlcXVpcmVkJyk7XG4gICAgICB9XG4gICAgICB2YXIgYm9keSA9IGNyZWF0ZUJvZHkocG9zKTtcbiAgICAgIGJvZGllcy5wdXNoKGJvZHkpO1xuXG4gICAgICByZXR1cm4gYm9keTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyBib2R5IGZyb20gdGhlIHN5c3RlbVxuICAgICAqXG4gICAgICogQHBhcmFtIHtuZ3JhcGgucGh5c2ljcy5wcmltaXRpdmVzLkJvZHl9IGJvZHkgdG8gcmVtb3ZlXG4gICAgICpcbiAgICAgKiBAcmV0dXJucyB7Qm9vbGVhbn0gdHJ1ZSBpZiBib2R5IGZvdW5kIGFuZCByZW1vdmVkLiBmYWxzeSBvdGhlcndpc2U7XG4gICAgICovXG4gICAgcmVtb3ZlQm9keTogZnVuY3Rpb24gKGJvZHkpIHtcbiAgICAgIGlmICghYm9keSkgeyByZXR1cm47IH1cblxuICAgICAgdmFyIGlkeCA9IGJvZGllcy5pbmRleE9mKGJvZHkpO1xuICAgICAgaWYgKGlkeCA8IDApIHsgcmV0dXJuOyB9XG5cbiAgICAgIGJvZGllcy5zcGxpY2UoaWR4LCAxKTtcbiAgICAgIGlmIChib2RpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGJvdW5kcy5yZXNldCgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIEFkZHMgYSBzcHJpbmcgdG8gdGhpcyBzaW11bGF0aW9uLlxuICAgICAqXG4gICAgICogQHJldHVybnMge09iamVjdH0gLSBhIGhhbmRsZSBmb3IgYSBzcHJpbmcuIElmIHlvdSB3YW50IHRvIGxhdGVyIHJlbW92ZVxuICAgICAqIHNwcmluZyBwYXNzIGl0IHRvIHJlbW92ZVNwcmluZygpIG1ldGhvZC5cbiAgICAgKi9cbiAgICBhZGRTcHJpbmc6IGZ1bmN0aW9uIChib2R5MSwgYm9keTIsIHNwcmluZ0xlbmd0aCwgc3ByaW5nV2VpZ2h0LCBzcHJpbmdDb2VmZmljaWVudCkge1xuICAgICAgaWYgKCFib2R5MSB8fCAhYm9keTIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgYWRkIG51bGwgc3ByaW5nIHRvIGZvcmNlIHNpbXVsYXRvcicpO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZW9mIHNwcmluZ0xlbmd0aCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgc3ByaW5nTGVuZ3RoID0gLTE7IC8vIGFzc3VtZSBnbG9iYWwgY29uZmlndXJhdGlvblxuICAgICAgfVxuXG4gICAgICB2YXIgc3ByaW5nID0gbmV3IFNwcmluZyhib2R5MSwgYm9keTIsIHNwcmluZ0xlbmd0aCwgc3ByaW5nQ29lZmZpY2llbnQgPj0gMCA/IHNwcmluZ0NvZWZmaWNpZW50IDogLTEsIHNwcmluZ1dlaWdodCk7XG4gICAgICBzcHJpbmdzLnB1c2goc3ByaW5nKTtcblxuICAgICAgLy8gVE9ETzogY291bGQgbWFyayBzaW11bGF0b3IgYXMgZGlydHkuXG4gICAgICByZXR1cm4gc3ByaW5nO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFtb3VudCBvZiBtb3ZlbWVudCBwZXJmb3JtZWQgb24gbGFzdCBzdGVwKCkgY2FsbFxuICAgICAqL1xuICAgIGdldFRvdGFsTW92ZW1lbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgIHJldHVybiB0b3RhbE1vdmVtZW50O1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZW1vdmVzIHNwcmluZyBmcm9tIHRoZSBzeXN0ZW1cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBzcHJpbmcgdG8gcmVtb3ZlLiBTcHJpbmcgaXMgYW4gb2JqZWN0IHJldHVybmVkIGJ5IGFkZFNwcmluZ1xuICAgICAqXG4gICAgICogQHJldHVybnMge0Jvb2xlYW59IHRydWUgaWYgc3ByaW5nIGZvdW5kIGFuZCByZW1vdmVkLiBmYWxzeSBvdGhlcndpc2U7XG4gICAgICovXG4gICAgcmVtb3ZlU3ByaW5nOiBmdW5jdGlvbiAoc3ByaW5nKSB7XG4gICAgICBpZiAoIXNwcmluZykgeyByZXR1cm47IH1cbiAgICAgIHZhciBpZHggPSBzcHJpbmdzLmluZGV4T2Yoc3ByaW5nKTtcbiAgICAgIGlmIChpZHggPiAtMSkge1xuICAgICAgICBzcHJpbmdzLnNwbGljZShpZHgsIDEpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZ2V0QmVzdE5ld0JvZHlQb3NpdGlvbjogZnVuY3Rpb24gKG5laWdoYm9ycykge1xuICAgICAgcmV0dXJuIGJvdW5kcy5nZXRCZXN0TmV3UG9zaXRpb24obmVpZ2hib3JzKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyBib3VuZGluZyBib3ggd2hpY2ggY292ZXJzIGFsbCBib2RpZXNcbiAgICAgKi9cbiAgICBnZXRCQm94OiBmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gYm91bmRzLmJveDtcbiAgICB9LFxuXG4gICAgZ3Jhdml0eTogZnVuY3Rpb24gKHZhbHVlKSB7XG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBzZXR0aW5ncy5ncmF2aXR5ID0gdmFsdWU7XG4gICAgICAgIHF1YWRUcmVlLm9wdGlvbnMoe2dyYXZpdHk6IHZhbHVlfSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHNldHRpbmdzLmdyYXZpdHk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHRoZXRhOiBmdW5jdGlvbiAodmFsdWUpIHtcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHNldHRpbmdzLnRoZXRhID0gdmFsdWU7XG4gICAgICAgIHF1YWRUcmVlLm9wdGlvbnMoe3RoZXRhOiB2YWx1ZX0pO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBzZXR0aW5ncy50aGV0YTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gYWxsb3cgc2V0dGluZ3MgbW9kaWZpY2F0aW9uIHZpYSBwdWJsaWMgQVBJOlxuICBleHBvc2Uoc2V0dGluZ3MsIHB1YmxpY0FwaSk7XG4gIGV2ZW50aWZ5KHB1YmxpY0FwaSk7XG5cbiAgcmV0dXJuIHB1YmxpY0FwaTtcblxuICBmdW5jdGlvbiBhY2N1bXVsYXRlRm9yY2VzKCkge1xuICAgIC8vIEFjY3VtdWxhdGUgZm9yY2VzIGFjdGluZyBvbiBib2RpZXMuXG4gICAgdmFyIGJvZHksXG4gICAgICAgIGkgPSBib2RpZXMubGVuZ3RoO1xuXG4gICAgaWYgKGkpIHtcbiAgICAgIC8vIG9ubHkgYWRkIGJvZGllcyBpZiB0aGVyZSB0aGUgYXJyYXkgaXMgbm90IGVtcHR5OlxuICAgICAgcXVhZFRyZWUuaW5zZXJ0Qm9kaWVzKGJvZGllcyk7IC8vIHBlcmZvcm1hbmNlOiBPKG4gKiBsb2cgbilcbiAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgYm9keSA9IGJvZGllc1tpXTtcbiAgICAgICAgLy8gSWYgYm9keSBpcyBwaW5uZWQgdGhlcmUgaXMgbm8gcG9pbnQgdXBkYXRpbmcgaXRzIGZvcmNlcyAtIGl0IHNob3VsZFxuICAgICAgICAvLyBuZXZlciBtb3ZlOlxuICAgICAgICBpZiAoIWJvZHkuaXNQaW5uZWQpIHtcbiAgICAgICAgICBib2R5LmZvcmNlLnJlc2V0KCk7XG5cbiAgICAgICAgICBxdWFkVHJlZS51cGRhdGVCb2R5Rm9yY2UoYm9keSk7XG4gICAgICAgICAgZHJhZ0ZvcmNlLnVwZGF0ZShib2R5KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGkgPSBzcHJpbmdzLmxlbmd0aDtcbiAgICB3aGlsZShpLS0pIHtcbiAgICAgIHNwcmluZ0ZvcmNlLnVwZGF0ZShzcHJpbmdzW2ldKTtcbiAgICB9XG4gIH1cbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChib2RpZXMsIHNldHRpbmdzKSB7XG4gIHZhciByYW5kb20gPSByZXF1aXJlKCduZ3JhcGgucmFuZG9tJykucmFuZG9tKDQyKTtcbiAgdmFyIGJvdW5kaW5nQm94ID0gIHsgeDE6IDAsIHkxOiAwLCB4MjogMCwgeTI6IDAgfTtcblxuICByZXR1cm4ge1xuICAgIGJveDogYm91bmRpbmdCb3gsXG5cbiAgICB1cGRhdGU6IHVwZGF0ZUJvdW5kaW5nQm94LFxuXG4gICAgcmVzZXQgOiBmdW5jdGlvbiAoKSB7XG4gICAgICBib3VuZGluZ0JveC54MSA9IGJvdW5kaW5nQm94LnkxID0gMDtcbiAgICAgIGJvdW5kaW5nQm94LngyID0gYm91bmRpbmdCb3gueTIgPSAwO1xuICAgIH0sXG5cbiAgICBnZXRCZXN0TmV3UG9zaXRpb246IGZ1bmN0aW9uIChuZWlnaGJvcnMpIHtcbiAgICAgIHZhciBncmFwaFJlY3QgPSBib3VuZGluZ0JveDtcblxuICAgICAgdmFyIGJhc2VYID0gMCwgYmFzZVkgPSAwO1xuXG4gICAgICBpZiAobmVpZ2hib3JzLmxlbmd0aCkge1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5laWdoYm9ycy5sZW5ndGg7ICsraSkge1xuICAgICAgICAgIGJhc2VYICs9IG5laWdoYm9yc1tpXS5wb3MueDtcbiAgICAgICAgICBiYXNlWSArPSBuZWlnaGJvcnNbaV0ucG9zLnk7XG4gICAgICAgIH1cblxuICAgICAgICBiYXNlWCAvPSBuZWlnaGJvcnMubGVuZ3RoO1xuICAgICAgICBiYXNlWSAvPSBuZWlnaGJvcnMubGVuZ3RoO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYmFzZVggPSAoZ3JhcGhSZWN0LngxICsgZ3JhcGhSZWN0LngyKSAvIDI7XG4gICAgICAgIGJhc2VZID0gKGdyYXBoUmVjdC55MSArIGdyYXBoUmVjdC55MikgLyAyO1xuICAgICAgfVxuXG4gICAgICB2YXIgc3ByaW5nTGVuZ3RoID0gc2V0dGluZ3Muc3ByaW5nTGVuZ3RoO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgeDogYmFzZVggKyByYW5kb20ubmV4dChzcHJpbmdMZW5ndGgpIC0gc3ByaW5nTGVuZ3RoIC8gMixcbiAgICAgICAgeTogYmFzZVkgKyByYW5kb20ubmV4dChzcHJpbmdMZW5ndGgpIC0gc3ByaW5nTGVuZ3RoIC8gMlxuICAgICAgfTtcbiAgICB9XG4gIH07XG5cbiAgZnVuY3Rpb24gdXBkYXRlQm91bmRpbmdCb3goKSB7XG4gICAgdmFyIGkgPSBib2RpZXMubGVuZ3RoO1xuICAgIGlmIChpID09PSAwKSB7IHJldHVybjsgfSAvLyBkb24ndCBoYXZlIHRvIHdvcnkgaGVyZS5cblxuICAgIHZhciB4MSA9IE51bWJlci5NQVhfVkFMVUUsXG4gICAgICAgIHkxID0gTnVtYmVyLk1BWF9WQUxVRSxcbiAgICAgICAgeDIgPSBOdW1iZXIuTUlOX1ZBTFVFLFxuICAgICAgICB5MiA9IE51bWJlci5NSU5fVkFMVUU7XG5cbiAgICB3aGlsZShpLS0pIHtcbiAgICAgIC8vIHRoaXMgaXMgTyhuKSwgY291bGQgaXQgYmUgZG9uZSBmYXN0ZXIgd2l0aCBxdWFkdHJlZT9cbiAgICAgIC8vIGhvdyBhYm91dCBwaW5uZWQgbm9kZXM/XG4gICAgICB2YXIgYm9keSA9IGJvZGllc1tpXTtcbiAgICAgIGlmIChib2R5LmlzUGlubmVkKSB7XG4gICAgICAgIGJvZHkucG9zLnggPSBib2R5LnByZXZQb3MueDtcbiAgICAgICAgYm9keS5wb3MueSA9IGJvZHkucHJldlBvcy55O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYm9keS5wcmV2UG9zLnggPSBib2R5LnBvcy54O1xuICAgICAgICBib2R5LnByZXZQb3MueSA9IGJvZHkucG9zLnk7XG4gICAgICB9XG4gICAgICBpZiAoYm9keS5wb3MueCA8IHgxKSB7XG4gICAgICAgIHgxID0gYm9keS5wb3MueDtcbiAgICAgIH1cbiAgICAgIGlmIChib2R5LnBvcy54ID4geDIpIHtcbiAgICAgICAgeDIgPSBib2R5LnBvcy54O1xuICAgICAgfVxuICAgICAgaWYgKGJvZHkucG9zLnkgPCB5MSkge1xuICAgICAgICB5MSA9IGJvZHkucG9zLnk7XG4gICAgICB9XG4gICAgICBpZiAoYm9keS5wb3MueSA+IHkyKSB7XG4gICAgICAgIHkyID0gYm9keS5wb3MueTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBib3VuZGluZ0JveC54MSA9IHgxO1xuICAgIGJvdW5kaW5nQm94LngyID0geDI7XG4gICAgYm91bmRpbmdCb3gueTEgPSB5MTtcbiAgICBib3VuZGluZ0JveC55MiA9IHkyO1xuICB9XG59XG4iLCJ2YXIgcGh5c2ljcyA9IHJlcXVpcmUoJ25ncmFwaC5waHlzaWNzLnByaW1pdGl2ZXMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihwb3MpIHtcbiAgcmV0dXJuIG5ldyBwaHlzaWNzLkJvZHkocG9zKTtcbn1cbiIsIi8qKlxuICogUmVwcmVzZW50cyBkcmFnIGZvcmNlLCB3aGljaCByZWR1Y2VzIGZvcmNlIHZhbHVlIG9uIGVhY2ggc3RlcCBieSBnaXZlblxuICogY29lZmZpY2llbnQuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgZm9yIHRoZSBkcmFnIGZvcmNlXG4gKiBAcGFyYW0ge051bWJlcj19IG9wdGlvbnMuZHJhZ0NvZWZmIGRyYWcgZm9yY2UgY29lZmZpY2llbnQuIDAuMSBieSBkZWZhdWx0XG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyksXG4gICAgICBleHBvc2UgPSByZXF1aXJlKCduZ3JhcGguZXhwb3NlJyk7XG5cbiAgb3B0aW9ucyA9IG1lcmdlKG9wdGlvbnMsIHtcbiAgICBkcmFnQ29lZmY6IDAuMDJcbiAgfSk7XG5cbiAgdmFyIGFwaSA9IHtcbiAgICB1cGRhdGUgOiBmdW5jdGlvbiAoYm9keSkge1xuICAgICAgYm9keS5mb3JjZS54IC09IG9wdGlvbnMuZHJhZ0NvZWZmICogYm9keS52ZWxvY2l0eS54O1xuICAgICAgYm9keS5mb3JjZS55IC09IG9wdGlvbnMuZHJhZ0NvZWZmICogYm9keS52ZWxvY2l0eS55O1xuICAgIH1cbiAgfTtcblxuICAvLyBsZXQgZWFzeSBhY2Nlc3MgdG8gZHJhZ0NvZWZmOlxuICBleHBvc2Uob3B0aW9ucywgYXBpLCBbJ2RyYWdDb2VmZiddKTtcblxuICByZXR1cm4gYXBpO1xufTtcbiIsIi8qKlxuICogUGVyZm9ybXMgZm9yY2VzIGludGVncmF0aW9uLCB1c2luZyBnaXZlbiB0aW1lc3RlcC4gVXNlcyBFdWxlciBtZXRob2QgdG8gc29sdmVcbiAqIGRpZmZlcmVudGlhbCBlcXVhdGlvbiAoaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9FdWxlcl9tZXRob2QgKS5cbiAqXG4gKiBAcmV0dXJucyB7TnVtYmVyfSBzcXVhcmVkIGRpc3RhbmNlIG9mIHRvdGFsIHBvc2l0aW9uIHVwZGF0ZXMuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpbnRlZ3JhdGU7XG5cbmZ1bmN0aW9uIGludGVncmF0ZShib2RpZXMsIHRpbWVTdGVwKSB7XG4gIHZhciBkeCA9IDAsIHR4ID0gMCxcbiAgICAgIGR5ID0gMCwgdHkgPSAwLFxuICAgICAgaSxcbiAgICAgIG1heCA9IGJvZGllcy5sZW5ndGg7XG5cbiAgaWYgKG1heCA9PT0gMCkge1xuICAgIHJldHVybiAwO1xuICB9XG5cbiAgZm9yIChpID0gMDsgaSA8IG1heDsgKytpKSB7XG4gICAgdmFyIGJvZHkgPSBib2RpZXNbaV0sXG4gICAgICAgIGNvZWZmID0gdGltZVN0ZXAgLyBib2R5Lm1hc3M7XG5cbiAgICBib2R5LnZlbG9jaXR5LnggKz0gY29lZmYgKiBib2R5LmZvcmNlLng7XG4gICAgYm9keS52ZWxvY2l0eS55ICs9IGNvZWZmICogYm9keS5mb3JjZS55O1xuICAgIHZhciB2eCA9IGJvZHkudmVsb2NpdHkueCxcbiAgICAgICAgdnkgPSBib2R5LnZlbG9jaXR5LnksXG4gICAgICAgIHYgPSBNYXRoLnNxcnQodnggKiB2eCArIHZ5ICogdnkpO1xuXG4gICAgaWYgKHYgPiAxKSB7XG4gICAgICBib2R5LnZlbG9jaXR5LnggPSB2eCAvIHY7XG4gICAgICBib2R5LnZlbG9jaXR5LnkgPSB2eSAvIHY7XG4gICAgfVxuXG4gICAgZHggPSB0aW1lU3RlcCAqIGJvZHkudmVsb2NpdHkueDtcbiAgICBkeSA9IHRpbWVTdGVwICogYm9keS52ZWxvY2l0eS55O1xuXG4gICAgYm9keS5wb3MueCArPSBkeDtcbiAgICBib2R5LnBvcy55ICs9IGR5O1xuXG4gICAgdHggKz0gTWF0aC5hYnMoZHgpOyB0eSArPSBNYXRoLmFicyhkeSk7XG4gIH1cblxuICByZXR1cm4gKHR4ICogdHggKyB0eSAqIHR5KS9tYXg7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFNwcmluZztcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgcGh5c2ljYWwgc3ByaW5nLiBTcHJpbmcgY29ubmVjdHMgdHdvIGJvZGllcywgaGFzIHJlc3QgbGVuZ3RoXG4gKiBzdGlmZm5lc3MgY29lZmZpY2llbnQgYW5kIG9wdGlvbmFsIHdlaWdodFxuICovXG5mdW5jdGlvbiBTcHJpbmcoZnJvbUJvZHksIHRvQm9keSwgbGVuZ3RoLCBjb2VmZiwgd2VpZ2h0KSB7XG4gICAgdGhpcy5mcm9tID0gZnJvbUJvZHk7XG4gICAgdGhpcy50byA9IHRvQm9keTtcbiAgICB0aGlzLmxlbmd0aCA9IGxlbmd0aDtcbiAgICB0aGlzLmNvZWZmID0gY29lZmY7XG5cbiAgICB0aGlzLndlaWdodCA9IHR5cGVvZiB3ZWlnaHQgPT09ICdudW1iZXInID8gd2VpZ2h0IDogMTtcbn07XG4iLCIvKipcbiAqIFJlcHJlc2VudHMgc3ByaW5nIGZvcmNlLCB3aGljaCB1cGRhdGVzIGZvcmNlcyBhY3Rpbmcgb24gdHdvIGJvZGllcywgY29ubnRlY3RlZFxuICogYnkgYSBzcHJpbmcuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgZm9yIHRoZSBzcHJpbmcgZm9yY2VcbiAqIEBwYXJhbSB7TnVtYmVyPX0gb3B0aW9ucy5zcHJpbmdDb2VmZiBzcHJpbmcgZm9yY2UgY29lZmZpY2llbnQuXG4gKiBAcGFyYW0ge051bWJlcj19IG9wdGlvbnMuc3ByaW5nTGVuZ3RoIGRlc2lyZWQgbGVuZ3RoIG9mIGEgc3ByaW5nIGF0IHJlc3QuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgdmFyIG1lcmdlID0gcmVxdWlyZSgnbmdyYXBoLm1lcmdlJyk7XG4gIHZhciByYW5kb20gPSByZXF1aXJlKCduZ3JhcGgucmFuZG9tJykucmFuZG9tKDQyKTtcbiAgdmFyIGV4cG9zZSA9IHJlcXVpcmUoJ25ncmFwaC5leHBvc2UnKTtcblxuICBvcHRpb25zID0gbWVyZ2Uob3B0aW9ucywge1xuICAgIHNwcmluZ0NvZWZmOiAwLjAwMDIsXG4gICAgc3ByaW5nTGVuZ3RoOiA4MFxuICB9KTtcblxuICB2YXIgYXBpID0ge1xuICAgIC8qKlxuICAgICAqIFVwc2F0ZXMgZm9yY2VzIGFjdGluZyBvbiBhIHNwcmluZ1xuICAgICAqL1xuICAgIHVwZGF0ZSA6IGZ1bmN0aW9uIChzcHJpbmcpIHtcbiAgICAgIHZhciBib2R5MSA9IHNwcmluZy5mcm9tLFxuICAgICAgICAgIGJvZHkyID0gc3ByaW5nLnRvLFxuICAgICAgICAgIGxlbmd0aCA9IHNwcmluZy5sZW5ndGggPCAwID8gb3B0aW9ucy5zcHJpbmdMZW5ndGggOiBzcHJpbmcubGVuZ3RoLFxuICAgICAgICAgIGR4ID0gYm9keTIucG9zLnggLSBib2R5MS5wb3MueCxcbiAgICAgICAgICBkeSA9IGJvZHkyLnBvcy55IC0gYm9keTEucG9zLnksXG4gICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSk7XG5cbiAgICAgIGlmIChyID09PSAwKSB7XG4gICAgICAgICAgZHggPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICBkeSA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgIHIgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xuICAgICAgfVxuXG4gICAgICB2YXIgZCA9IHIgLSBsZW5ndGg7XG4gICAgICB2YXIgY29lZmYgPSAoKCFzcHJpbmcuY29lZmYgfHwgc3ByaW5nLmNvZWZmIDwgMCkgPyBvcHRpb25zLnNwcmluZ0NvZWZmIDogc3ByaW5nLmNvZWZmKSAqIGQgLyByICogc3ByaW5nLndlaWdodDtcblxuICAgICAgYm9keTEuZm9yY2UueCArPSBjb2VmZiAqIGR4O1xuICAgICAgYm9keTEuZm9yY2UueSArPSBjb2VmZiAqIGR5O1xuXG4gICAgICBib2R5Mi5mb3JjZS54IC09IGNvZWZmICogZHg7XG4gICAgICBib2R5Mi5mb3JjZS55IC09IGNvZWZmICogZHk7XG4gICAgfVxuICB9O1xuXG4gIGV4cG9zZShvcHRpb25zLCBhcGksIFsnc3ByaW5nQ29lZmYnLCAnc3ByaW5nTGVuZ3RoJ10pO1xuICByZXR1cm4gYXBpO1xufVxuIiwiLyoqXG4gKiBUaGlzIGlzIEJhcm5lcyBIdXQgc2ltdWxhdGlvbiBhbGdvcml0aG0gZm9yIDJkIGNhc2UuIEltcGxlbWVudGF0aW9uXG4gKiBpcyBoaWdobHkgb3B0aW1pemVkIChhdm9pZHMgcmVjdXNpb24gYW5kIGdjIHByZXNzdXJlKVxuICpcbiAqIGh0dHA6Ly93d3cuY3MucHJpbmNldG9uLmVkdS9jb3Vyc2VzL2FyY2hpdmUvZmFsbDAzL2NzMTI2L2Fzc2lnbm1lbnRzL2Jhcm5lcy1odXQuaHRtbFxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ob3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgb3B0aW9ucy5ncmF2aXR5ID0gdHlwZW9mIG9wdGlvbnMuZ3Jhdml0eSA9PT0gJ251bWJlcicgPyBvcHRpb25zLmdyYXZpdHkgOiAtMTtcbiAgb3B0aW9ucy50aGV0YSA9IHR5cGVvZiBvcHRpb25zLnRoZXRhID09PSAnbnVtYmVyJyA/IG9wdGlvbnMudGhldGEgOiAwLjg7XG5cbiAgLy8gd2UgcmVxdWlyZSBkZXRlcm1pbmlzdGljIHJhbmRvbW5lc3MgaGVyZVxuICB2YXIgcmFuZG9tID0gcmVxdWlyZSgnbmdyYXBoLnJhbmRvbScpLnJhbmRvbSgxOTg0KSxcbiAgICBOb2RlID0gcmVxdWlyZSgnLi9ub2RlJyksXG4gICAgSW5zZXJ0U3RhY2sgPSByZXF1aXJlKCcuL2luc2VydFN0YWNrJyksXG4gICAgaXNTYW1lUG9zaXRpb24gPSByZXF1aXJlKCcuL2lzU2FtZVBvc2l0aW9uJyk7XG5cbiAgdmFyIGdyYXZpdHkgPSBvcHRpb25zLmdyYXZpdHksXG4gICAgdXBkYXRlUXVldWUgPSBbXSxcbiAgICBpbnNlcnRTdGFjayA9IG5ldyBJbnNlcnRTdGFjaygpLFxuICAgIHRoZXRhID0gb3B0aW9ucy50aGV0YSxcblxuICAgIG5vZGVzQ2FjaGUgPSBbXSxcbiAgICBjdXJyZW50SW5DYWNoZSA9IDAsXG4gICAgbmV3Tm9kZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgLy8gVG8gYXZvaWQgcHJlc3N1cmUgb24gR0Mgd2UgcmV1c2Ugbm9kZXMuXG4gICAgICB2YXIgbm9kZSA9IG5vZGVzQ2FjaGVbY3VycmVudEluQ2FjaGVdO1xuICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgbm9kZS5xdWFkMCA9IG51bGw7XG4gICAgICAgIG5vZGUucXVhZDEgPSBudWxsO1xuICAgICAgICBub2RlLnF1YWQyID0gbnVsbDtcbiAgICAgICAgbm9kZS5xdWFkMyA9IG51bGw7XG4gICAgICAgIG5vZGUuYm9keSA9IG51bGw7XG4gICAgICAgIG5vZGUubWFzcyA9IG5vZGUubWFzc1ggPSBub2RlLm1hc3NZID0gMDtcbiAgICAgICAgbm9kZS5sZWZ0ID0gbm9kZS5yaWdodCA9IG5vZGUudG9wID0gbm9kZS5ib3R0b20gPSAwO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbm9kZSA9IG5ldyBOb2RlKCk7XG4gICAgICAgIG5vZGVzQ2FjaGVbY3VycmVudEluQ2FjaGVdID0gbm9kZTtcbiAgICAgIH1cblxuICAgICAgKytjdXJyZW50SW5DYWNoZTtcbiAgICAgIHJldHVybiBub2RlO1xuICAgIH0sXG5cbiAgICByb290ID0gbmV3Tm9kZSgpLFxuXG4gICAgLy8gSW5zZXJ0cyBib2R5IHRvIHRoZSB0cmVlXG4gICAgaW5zZXJ0ID0gZnVuY3Rpb24obmV3Qm9keSkge1xuICAgICAgaW5zZXJ0U3RhY2sucmVzZXQoKTtcbiAgICAgIGluc2VydFN0YWNrLnB1c2gocm9vdCwgbmV3Qm9keSk7XG5cbiAgICAgIHdoaWxlICghaW5zZXJ0U3RhY2suaXNFbXB0eSgpKSB7XG4gICAgICAgIHZhciBzdGFja0l0ZW0gPSBpbnNlcnRTdGFjay5wb3AoKSxcbiAgICAgICAgICBub2RlID0gc3RhY2tJdGVtLm5vZGUsXG4gICAgICAgICAgYm9keSA9IHN0YWNrSXRlbS5ib2R5O1xuXG4gICAgICAgIGlmICghbm9kZS5ib2R5KSB7XG4gICAgICAgICAgLy8gVGhpcyBpcyBpbnRlcm5hbCBub2RlLiBVcGRhdGUgdGhlIHRvdGFsIG1hc3Mgb2YgdGhlIG5vZGUgYW5kIGNlbnRlci1vZi1tYXNzLlxuICAgICAgICAgIHZhciB4ID0gYm9keS5wb3MueDtcbiAgICAgICAgICB2YXIgeSA9IGJvZHkucG9zLnk7XG4gICAgICAgICAgbm9kZS5tYXNzID0gbm9kZS5tYXNzICsgYm9keS5tYXNzO1xuICAgICAgICAgIG5vZGUubWFzc1ggPSBub2RlLm1hc3NYICsgYm9keS5tYXNzICogeDtcbiAgICAgICAgICBub2RlLm1hc3NZID0gbm9kZS5tYXNzWSArIGJvZHkubWFzcyAqIHk7XG5cbiAgICAgICAgICAvLyBSZWN1cnNpdmVseSBpbnNlcnQgdGhlIGJvZHkgaW4gdGhlIGFwcHJvcHJpYXRlIHF1YWRyYW50LlxuICAgICAgICAgIC8vIEJ1dCBmaXJzdCBmaW5kIHRoZSBhcHByb3ByaWF0ZSBxdWFkcmFudC5cbiAgICAgICAgICB2YXIgcXVhZElkeCA9IDAsIC8vIEFzc3VtZSB3ZSBhcmUgaW4gdGhlIDAncyBxdWFkLlxuICAgICAgICAgICAgbGVmdCA9IG5vZGUubGVmdCxcbiAgICAgICAgICAgIHJpZ2h0ID0gKG5vZGUucmlnaHQgKyBsZWZ0KSAvIDIsXG4gICAgICAgICAgICB0b3AgPSBub2RlLnRvcCxcbiAgICAgICAgICAgIGJvdHRvbSA9IChub2RlLmJvdHRvbSArIHRvcCkgLyAyO1xuXG4gICAgICAgICAgaWYgKHggPiByaWdodCkgeyAvLyBzb21ld2hlcmUgaW4gdGhlIGVhc3Rlcm4gcGFydC5cbiAgICAgICAgICAgIHF1YWRJZHggPSBxdWFkSWR4ICsgMTtcbiAgICAgICAgICAgIHZhciBvbGRMZWZ0ID0gbGVmdDtcbiAgICAgICAgICAgIGxlZnQgPSByaWdodDtcbiAgICAgICAgICAgIHJpZ2h0ID0gcmlnaHQgKyAocmlnaHQgLSBvbGRMZWZ0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHkgPiBib3R0b20pIHsgLy8gYW5kIGluIHNvdXRoLlxuICAgICAgICAgICAgcXVhZElkeCA9IHF1YWRJZHggKyAyO1xuICAgICAgICAgICAgdmFyIG9sZFRvcCA9IHRvcDtcbiAgICAgICAgICAgIHRvcCA9IGJvdHRvbTtcbiAgICAgICAgICAgIGJvdHRvbSA9IGJvdHRvbSArIChib3R0b20gLSBvbGRUb3ApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHZhciBjaGlsZCA9IGdldENoaWxkKG5vZGUsIHF1YWRJZHgpO1xuICAgICAgICAgIGlmICghY2hpbGQpIHtcbiAgICAgICAgICAgIC8vIFRoZSBub2RlIGlzIGludGVybmFsIGJ1dCB0aGlzIHF1YWRyYW50IGlzIG5vdCB0YWtlbi4gQWRkXG4gICAgICAgICAgICAvLyBzdWJub2RlIHRvIGl0LlxuICAgICAgICAgICAgY2hpbGQgPSBuZXdOb2RlKCk7XG4gICAgICAgICAgICBjaGlsZC5sZWZ0ID0gbGVmdDtcbiAgICAgICAgICAgIGNoaWxkLnRvcCA9IHRvcDtcbiAgICAgICAgICAgIGNoaWxkLnJpZ2h0ID0gcmlnaHQ7XG4gICAgICAgICAgICBjaGlsZC5ib3R0b20gPSBib3R0b207XG4gICAgICAgICAgICBjaGlsZC5ib2R5ID0gYm9keTtcblxuICAgICAgICAgICAgc2V0Q2hpbGQobm9kZSwgcXVhZElkeCwgY2hpbGQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBjb250aW51ZSBzZWFyY2hpbmcgaW4gdGhpcyBxdWFkcmFudC5cbiAgICAgICAgICAgIGluc2VydFN0YWNrLnB1c2goY2hpbGQsIGJvZHkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBXZSBhcmUgdHJ5aW5nIHRvIGFkZCB0byB0aGUgbGVhZiBub2RlLlxuICAgICAgICAgIC8vIFdlIGhhdmUgdG8gY29udmVydCBjdXJyZW50IGxlYWYgaW50byBpbnRlcm5hbCBub2RlXG4gICAgICAgICAgLy8gYW5kIGNvbnRpbnVlIGFkZGluZyB0d28gbm9kZXMuXG4gICAgICAgICAgdmFyIG9sZEJvZHkgPSBub2RlLmJvZHk7XG4gICAgICAgICAgbm9kZS5ib2R5ID0gbnVsbDsgLy8gaW50ZXJuYWwgbm9kZXMgZG8gbm90IGNhcnkgYm9kaWVzXG5cbiAgICAgICAgICBpZiAoaXNTYW1lUG9zaXRpb24ob2xkQm9keS5wb3MsIGJvZHkucG9zKSkge1xuICAgICAgICAgICAgLy8gUHJldmVudCBpbmZpbml0ZSBzdWJkaXZpc2lvbiBieSBidW1waW5nIG9uZSBub2RlXG4gICAgICAgICAgICAvLyBhbnl3aGVyZSBpbiB0aGlzIHF1YWRyYW50XG4gICAgICAgICAgICB2YXIgcmV0cmllc0NvdW50ID0gMztcbiAgICAgICAgICAgIGRvIHtcbiAgICAgICAgICAgICAgdmFyIG9mZnNldCA9IHJhbmRvbS5uZXh0RG91YmxlKCk7XG4gICAgICAgICAgICAgIHZhciBkeCA9IChub2RlLnJpZ2h0IC0gbm9kZS5sZWZ0KSAqIG9mZnNldDtcbiAgICAgICAgICAgICAgdmFyIGR5ID0gKG5vZGUuYm90dG9tIC0gbm9kZS50b3ApICogb2Zmc2V0O1xuXG4gICAgICAgICAgICAgIG9sZEJvZHkucG9zLnggPSBub2RlLmxlZnQgKyBkeDtcbiAgICAgICAgICAgICAgb2xkQm9keS5wb3MueSA9IG5vZGUudG9wICsgZHk7XG4gICAgICAgICAgICAgIHJldHJpZXNDb3VudCAtPSAxO1xuICAgICAgICAgICAgICAvLyBNYWtlIHN1cmUgd2UgZG9uJ3QgYnVtcCBpdCBvdXQgb2YgdGhlIGJveC4gSWYgd2UgZG8sIG5leHQgaXRlcmF0aW9uIHNob3VsZCBmaXggaXRcbiAgICAgICAgICAgIH0gd2hpbGUgKHJldHJpZXNDb3VudCA+IDAgJiYgaXNTYW1lUG9zaXRpb24ob2xkQm9keS5wb3MsIGJvZHkucG9zKSk7XG5cbiAgICAgICAgICAgIGlmIChyZXRyaWVzQ291bnQgPT09IDAgJiYgaXNTYW1lUG9zaXRpb24ob2xkQm9keS5wb3MsIGJvZHkucG9zKSkge1xuICAgICAgICAgICAgICAvLyBUaGlzIGlzIHZlcnkgYmFkLCB3ZSByYW4gb3V0IG9mIHByZWNpc2lvbi5cbiAgICAgICAgICAgICAgLy8gaWYgd2UgZG8gbm90IHJldHVybiBmcm9tIHRoZSBtZXRob2Qgd2UnbGwgZ2V0IGludG9cbiAgICAgICAgICAgICAgLy8gaW5maW5pdGUgbG9vcCBoZXJlLiBTbyB3ZSBzYWNyaWZpY2UgY29ycmVjdG5lc3Mgb2YgbGF5b3V0LCBhbmQga2VlcCB0aGUgYXBwIHJ1bm5pbmdcbiAgICAgICAgICAgICAgLy8gTmV4dCBsYXlvdXQgaXRlcmF0aW9uIHNob3VsZCBnZXQgbGFyZ2VyIGJvdW5kaW5nIGJveCBpbiB0aGUgZmlyc3Qgc3RlcCBhbmQgZml4IHRoaXNcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBOZXh0IGl0ZXJhdGlvbiBzaG91bGQgc3ViZGl2aWRlIG5vZGUgZnVydGhlci5cbiAgICAgICAgICBpbnNlcnRTdGFjay5wdXNoKG5vZGUsIG9sZEJvZHkpO1xuICAgICAgICAgIGluc2VydFN0YWNrLnB1c2gobm9kZSwgYm9keSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlID0gZnVuY3Rpb24oc291cmNlQm9keSkge1xuICAgICAgdmFyIHF1ZXVlID0gdXBkYXRlUXVldWUsXG4gICAgICAgIHYsXG4gICAgICAgIGR4LFxuICAgICAgICBkeSxcbiAgICAgICAgciwgZnggPSAwLFxuICAgICAgICBmeSA9IDAsXG4gICAgICAgIHF1ZXVlTGVuZ3RoID0gMSxcbiAgICAgICAgc2hpZnRJZHggPSAwLFxuICAgICAgICBwdXNoSWR4ID0gMTtcblxuICAgICAgcXVldWVbMF0gPSByb290O1xuXG4gICAgICB3aGlsZSAocXVldWVMZW5ndGgpIHtcbiAgICAgICAgdmFyIG5vZGUgPSBxdWV1ZVtzaGlmdElkeF0sXG4gICAgICAgICAgYm9keSA9IG5vZGUuYm9keTtcblxuICAgICAgICBxdWV1ZUxlbmd0aCAtPSAxO1xuICAgICAgICBzaGlmdElkeCArPSAxO1xuICAgICAgICB2YXIgZGlmZmVyZW50Qm9keSA9IChib2R5ICE9PSBzb3VyY2VCb2R5KTtcbiAgICAgICAgaWYgKGJvZHkgJiYgZGlmZmVyZW50Qm9keSkge1xuICAgICAgICAgIC8vIElmIHRoZSBjdXJyZW50IG5vZGUgaXMgYSBsZWFmIG5vZGUgKGFuZCBpdCBpcyBub3Qgc291cmNlIGJvZHkpLFxuICAgICAgICAgIC8vIGNhbGN1bGF0ZSB0aGUgZm9yY2UgZXhlcnRlZCBieSB0aGUgY3VycmVudCBub2RlIG9uIGJvZHksIGFuZCBhZGQgdGhpc1xuICAgICAgICAgIC8vIGFtb3VudCB0byBib2R5J3MgbmV0IGZvcmNlLlxuICAgICAgICAgIGR4ID0gYm9keS5wb3MueCAtIHNvdXJjZUJvZHkucG9zLng7XG4gICAgICAgICAgZHkgPSBib2R5LnBvcy55IC0gc291cmNlQm9keS5wb3MueTtcbiAgICAgICAgICByID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcblxuICAgICAgICAgIGlmIChyID09PSAwKSB7XG4gICAgICAgICAgICAvLyBQb29yIG1hbidzIHByb3RlY3Rpb24gYWdhaW5zdCB6ZXJvIGRpc3RhbmNlLlxuICAgICAgICAgICAgZHggPSAocmFuZG9tLm5leHREb3VibGUoKSAtIDAuNSkgLyA1MDtcbiAgICAgICAgICAgIGR5ID0gKHJhbmRvbS5uZXh0RG91YmxlKCkgLSAwLjUpIC8gNTA7XG4gICAgICAgICAgICByID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBUaGlzIGlzIHN0YW5kYXJkIGdyYXZpdGlvbiBmb3JjZSBjYWxjdWxhdGlvbiBidXQgd2UgZGl2aWRlXG4gICAgICAgICAgLy8gYnkgcl4zIHRvIHNhdmUgdHdvIG9wZXJhdGlvbnMgd2hlbiBub3JtYWxpemluZyBmb3JjZSB2ZWN0b3IuXG4gICAgICAgICAgdiA9IGdyYXZpdHkgKiBib2R5Lm1hc3MgKiBzb3VyY2VCb2R5Lm1hc3MgLyAociAqIHIgKiByKTtcbiAgICAgICAgICBmeCArPSB2ICogZHg7XG4gICAgICAgICAgZnkgKz0gdiAqIGR5O1xuICAgICAgICB9IGVsc2UgaWYgKGRpZmZlcmVudEJvZHkpIHtcbiAgICAgICAgICAvLyBPdGhlcndpc2UsIGNhbGN1bGF0ZSB0aGUgcmF0aW8gcyAvIHIsICB3aGVyZSBzIGlzIHRoZSB3aWR0aCBvZiB0aGUgcmVnaW9uXG4gICAgICAgICAgLy8gcmVwcmVzZW50ZWQgYnkgdGhlIGludGVybmFsIG5vZGUsIGFuZCByIGlzIHRoZSBkaXN0YW5jZSBiZXR3ZWVuIHRoZSBib2R5XG4gICAgICAgICAgLy8gYW5kIHRoZSBub2RlJ3MgY2VudGVyLW9mLW1hc3NcbiAgICAgICAgICBkeCA9IG5vZGUubWFzc1ggLyBub2RlLm1hc3MgLSBzb3VyY2VCb2R5LnBvcy54O1xuICAgICAgICAgIGR5ID0gbm9kZS5tYXNzWSAvIG5vZGUubWFzcyAtIHNvdXJjZUJvZHkucG9zLnk7XG4gICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSk7XG5cbiAgICAgICAgICBpZiAociA9PT0gMCkge1xuICAgICAgICAgICAgLy8gU29ycnkgYWJvdXQgY29kZSBkdXBsdWNhdGlvbi4gSSBkb24ndCB3YW50IHRvIGNyZWF0ZSBtYW55IGZ1bmN0aW9uc1xuICAgICAgICAgICAgLy8gcmlnaHQgYXdheS4gSnVzdCB3YW50IHRvIHNlZSBwZXJmb3JtYW5jZSBmaXJzdC5cbiAgICAgICAgICAgIGR4ID0gKHJhbmRvbS5uZXh0RG91YmxlKCkgLSAwLjUpIC8gNTA7XG4gICAgICAgICAgICBkeSA9IChyYW5kb20ubmV4dERvdWJsZSgpIC0gMC41KSAvIDUwO1xuICAgICAgICAgICAgciA9IE1hdGguc3FydChkeCAqIGR4ICsgZHkgKiBkeSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIElmIHMgLyByIDwgzrgsIHRyZWF0IHRoaXMgaW50ZXJuYWwgbm9kZSBhcyBhIHNpbmdsZSBib2R5LCBhbmQgY2FsY3VsYXRlIHRoZVxuICAgICAgICAgIC8vIGZvcmNlIGl0IGV4ZXJ0cyBvbiBzb3VyY2VCb2R5LCBhbmQgYWRkIHRoaXMgYW1vdW50IHRvIHNvdXJjZUJvZHkncyBuZXQgZm9yY2UuXG4gICAgICAgICAgaWYgKChub2RlLnJpZ2h0IC0gbm9kZS5sZWZ0KSAvIHIgPCB0aGV0YSkge1xuICAgICAgICAgICAgLy8gaW4gdGhlIGlmIHN0YXRlbWVudCBhYm92ZSB3ZSBjb25zaWRlciBub2RlJ3Mgd2lkdGggb25seVxuICAgICAgICAgICAgLy8gYmVjYXVzZSB0aGUgcmVnaW9uIHdhcyBzcXVhcmlmaWVkIGR1cmluZyB0cmVlIGNyZWF0aW9uLlxuICAgICAgICAgICAgLy8gVGh1cyB0aGVyZSBpcyBubyBkaWZmZXJlbmNlIGJldHdlZW4gdXNpbmcgd2lkdGggb3IgaGVpZ2h0LlxuICAgICAgICAgICAgdiA9IGdyYXZpdHkgKiBub2RlLm1hc3MgKiBzb3VyY2VCb2R5Lm1hc3MgLyAociAqIHIgKiByKTtcbiAgICAgICAgICAgIGZ4ICs9IHYgKiBkeDtcbiAgICAgICAgICAgIGZ5ICs9IHYgKiBkeTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gT3RoZXJ3aXNlLCBydW4gdGhlIHByb2NlZHVyZSByZWN1cnNpdmVseSBvbiBlYWNoIG9mIHRoZSBjdXJyZW50IG5vZGUncyBjaGlsZHJlbi5cblxuICAgICAgICAgICAgLy8gSSBpbnRlbnRpb25hbGx5IHVuZm9sZGVkIHRoaXMgbG9vcCwgdG8gc2F2ZSBzZXZlcmFsIENQVSBjeWNsZXMuXG4gICAgICAgICAgICBpZiAobm9kZS5xdWFkMCkge1xuICAgICAgICAgICAgICBxdWV1ZVtwdXNoSWR4XSA9IG5vZGUucXVhZDA7XG4gICAgICAgICAgICAgIHF1ZXVlTGVuZ3RoICs9IDE7XG4gICAgICAgICAgICAgIHB1c2hJZHggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChub2RlLnF1YWQxKSB7XG4gICAgICAgICAgICAgIHF1ZXVlW3B1c2hJZHhdID0gbm9kZS5xdWFkMTtcbiAgICAgICAgICAgICAgcXVldWVMZW5ndGggKz0gMTtcbiAgICAgICAgICAgICAgcHVzaElkeCArPSAxO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKG5vZGUucXVhZDIpIHtcbiAgICAgICAgICAgICAgcXVldWVbcHVzaElkeF0gPSBub2RlLnF1YWQyO1xuICAgICAgICAgICAgICBxdWV1ZUxlbmd0aCArPSAxO1xuICAgICAgICAgICAgICBwdXNoSWR4ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm9kZS5xdWFkMykge1xuICAgICAgICAgICAgICBxdWV1ZVtwdXNoSWR4XSA9IG5vZGUucXVhZDM7XG4gICAgICAgICAgICAgIHF1ZXVlTGVuZ3RoICs9IDE7XG4gICAgICAgICAgICAgIHB1c2hJZHggKz0gMTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc291cmNlQm9keS5mb3JjZS54ICs9IGZ4O1xuICAgICAgc291cmNlQm9keS5mb3JjZS55ICs9IGZ5O1xuICAgIH0sXG5cbiAgICBpbnNlcnRCb2RpZXMgPSBmdW5jdGlvbihib2RpZXMpIHtcbiAgICAgIHZhciB4MSA9IE51bWJlci5NQVhfVkFMVUUsXG4gICAgICAgIHkxID0gTnVtYmVyLk1BWF9WQUxVRSxcbiAgICAgICAgeDIgPSBOdW1iZXIuTUlOX1ZBTFVFLFxuICAgICAgICB5MiA9IE51bWJlci5NSU5fVkFMVUUsXG4gICAgICAgIGksXG4gICAgICAgIG1heCA9IGJvZGllcy5sZW5ndGg7XG5cbiAgICAgIC8vIFRvIHJlZHVjZSBxdWFkIHRyZWUgZGVwdGggd2UgYXJlIGxvb2tpbmcgZm9yIGV4YWN0IGJvdW5kaW5nIGJveCBvZiBhbGwgcGFydGljbGVzLlxuICAgICAgaSA9IG1heDtcbiAgICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgdmFyIHggPSBib2RpZXNbaV0ucG9zLng7XG4gICAgICAgIHZhciB5ID0gYm9kaWVzW2ldLnBvcy55O1xuICAgICAgICBpZiAoeCA8IHgxKSB7XG4gICAgICAgICAgeDEgPSB4O1xuICAgICAgICB9XG4gICAgICAgIGlmICh4ID4geDIpIHtcbiAgICAgICAgICB4MiA9IHg7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHkgPCB5MSkge1xuICAgICAgICAgIHkxID0geTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoeSA+IHkyKSB7XG4gICAgICAgICAgeTIgPSB5O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFNxdWFyaWZ5IHRoZSBib3VuZHMuXG4gICAgICB2YXIgZHggPSB4MiAtIHgxLFxuICAgICAgICBkeSA9IHkyIC0geTE7XG4gICAgICBpZiAoZHggPiBkeSkge1xuICAgICAgICB5MiA9IHkxICsgZHg7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB4MiA9IHgxICsgZHk7XG4gICAgICB9XG5cbiAgICAgIGN1cnJlbnRJbkNhY2hlID0gMDtcbiAgICAgIHJvb3QgPSBuZXdOb2RlKCk7XG4gICAgICByb290LmxlZnQgPSB4MTtcbiAgICAgIHJvb3QucmlnaHQgPSB4MjtcbiAgICAgIHJvb3QudG9wID0geTE7XG4gICAgICByb290LmJvdHRvbSA9IHkyO1xuXG4gICAgICBpID0gbWF4IC0gMTtcbiAgICAgIGlmIChpID4gMCkge1xuICAgICAgICByb290LmJvZHkgPSBib2RpZXNbaV07XG4gICAgICB9XG4gICAgICB3aGlsZSAoaS0tKSB7XG4gICAgICAgIGluc2VydChib2RpZXNbaV0sIHJvb3QpO1xuICAgICAgfVxuICAgIH07XG5cbiAgcmV0dXJuIHtcbiAgICBpbnNlcnRCb2RpZXM6IGluc2VydEJvZGllcyxcbiAgICB1cGRhdGVCb2R5Rm9yY2U6IHVwZGF0ZSxcbiAgICBvcHRpb25zOiBmdW5jdGlvbihuZXdPcHRpb25zKSB7XG4gICAgICBpZiAobmV3T3B0aW9ucykge1xuICAgICAgICBpZiAodHlwZW9mIG5ld09wdGlvbnMuZ3Jhdml0eSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICBncmF2aXR5ID0gbmV3T3B0aW9ucy5ncmF2aXR5O1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgbmV3T3B0aW9ucy50aGV0YSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgICB0aGV0YSA9IG5ld09wdGlvbnMudGhldGE7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZ3Jhdml0eTogZ3Jhdml0eSxcbiAgICAgICAgdGhldGE6IHRoZXRhXG4gICAgICB9O1xuICAgIH1cbiAgfTtcbn07XG5cbmZ1bmN0aW9uIGdldENoaWxkKG5vZGUsIGlkeCkge1xuICBpZiAoaWR4ID09PSAwKSByZXR1cm4gbm9kZS5xdWFkMDtcbiAgaWYgKGlkeCA9PT0gMSkgcmV0dXJuIG5vZGUucXVhZDE7XG4gIGlmIChpZHggPT09IDIpIHJldHVybiBub2RlLnF1YWQyO1xuICBpZiAoaWR4ID09PSAzKSByZXR1cm4gbm9kZS5xdWFkMztcbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIHNldENoaWxkKG5vZGUsIGlkeCwgY2hpbGQpIHtcbiAgaWYgKGlkeCA9PT0gMCkgbm9kZS5xdWFkMCA9IGNoaWxkO1xuICBlbHNlIGlmIChpZHggPT09IDEpIG5vZGUucXVhZDEgPSBjaGlsZDtcbiAgZWxzZSBpZiAoaWR4ID09PSAyKSBub2RlLnF1YWQyID0gY2hpbGQ7XG4gIGVsc2UgaWYgKGlkeCA9PT0gMykgbm9kZS5xdWFkMyA9IGNoaWxkO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBJbnNlcnRTdGFjaztcblxuLyoqXG4gKiBPdXIgaW1wbG1lbnRhdGlvbiBvZiBRdWFkVHJlZSBpcyBub24tcmVjdXJzaXZlIHRvIGF2b2lkIEdDIGhpdFxuICogVGhpcyBkYXRhIHN0cnVjdHVyZSByZXByZXNlbnQgc3RhY2sgb2YgZWxlbWVudHNcbiAqIHdoaWNoIHdlIGFyZSB0cnlpbmcgdG8gaW5zZXJ0IGludG8gcXVhZCB0cmVlLlxuICovXG5mdW5jdGlvbiBJbnNlcnRTdGFjayAoKSB7XG4gICAgdGhpcy5zdGFjayA9IFtdO1xuICAgIHRoaXMucG9wSWR4ID0gMDtcbn1cblxuSW5zZXJ0U3RhY2sucHJvdG90eXBlID0ge1xuICAgIGlzRW1wdHk6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5wb3BJZHggPT09IDA7XG4gICAgfSxcbiAgICBwdXNoOiBmdW5jdGlvbiAobm9kZSwgYm9keSkge1xuICAgICAgICB2YXIgaXRlbSA9IHRoaXMuc3RhY2tbdGhpcy5wb3BJZHhdO1xuICAgICAgICBpZiAoIWl0ZW0pIHtcbiAgICAgICAgICAgIC8vIHdlIGFyZSB0cnlpbmcgdG8gYXZvaWQgbWVtb3J5IHByZXNzdWU6IGNyZWF0ZSBuZXcgZWxlbWVudFxuICAgICAgICAgICAgLy8gb25seSB3aGVuIGFic29sdXRlbHkgbmVjZXNzYXJ5XG4gICAgICAgICAgICB0aGlzLnN0YWNrW3RoaXMucG9wSWR4XSA9IG5ldyBJbnNlcnRTdGFja0VsZW1lbnQobm9kZSwgYm9keSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpdGVtLm5vZGUgPSBub2RlO1xuICAgICAgICAgICAgaXRlbS5ib2R5ID0gYm9keTtcbiAgICAgICAgfVxuICAgICAgICArK3RoaXMucG9wSWR4O1xuICAgIH0sXG4gICAgcG9wOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGlmICh0aGlzLnBvcElkeCA+IDApIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN0YWNrWy0tdGhpcy5wb3BJZHhdO1xuICAgICAgICB9XG4gICAgfSxcbiAgICByZXNldDogZnVuY3Rpb24gKCkge1xuICAgICAgICB0aGlzLnBvcElkeCA9IDA7XG4gICAgfVxufTtcblxuZnVuY3Rpb24gSW5zZXJ0U3RhY2tFbGVtZW50KG5vZGUsIGJvZHkpIHtcbiAgICB0aGlzLm5vZGUgPSBub2RlOyAvLyBRdWFkVHJlZSBub2RlXG4gICAgdGhpcy5ib2R5ID0gYm9keTsgLy8gcGh5c2ljYWwgYm9keSB3aGljaCBuZWVkcyB0byBiZSBpbnNlcnRlZCB0byBub2RlXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGlzU2FtZVBvc2l0aW9uKHBvaW50MSwgcG9pbnQyKSB7XG4gICAgdmFyIGR4ID0gTWF0aC5hYnMocG9pbnQxLnggLSBwb2ludDIueCk7XG4gICAgdmFyIGR5ID0gTWF0aC5hYnMocG9pbnQxLnkgLSBwb2ludDIueSk7XG5cbiAgICByZXR1cm4gKGR4IDwgMWUtOCAmJiBkeSA8IDFlLTgpO1xufTtcbiIsIi8qKlxuICogSW50ZXJuYWwgZGF0YSBzdHJ1Y3R1cmUgdG8gcmVwcmVzZW50IDJEIFF1YWRUcmVlIG5vZGVcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBOb2RlKCkge1xuICAvLyBib2R5IHN0b3JlZCBpbnNpZGUgdGhpcyBub2RlLiBJbiBxdWFkIHRyZWUgb25seSBsZWFmIG5vZGVzIChieSBjb25zdHJ1Y3Rpb24pXG4gIC8vIGNvbnRhaW4gYm9pZGVzOlxuICB0aGlzLmJvZHkgPSBudWxsO1xuXG4gIC8vIENoaWxkIG5vZGVzIGFyZSBzdG9yZWQgaW4gcXVhZHMuIEVhY2ggcXVhZCBpcyBwcmVzZW50ZWQgYnkgbnVtYmVyOlxuICAvLyAwIHwgMVxuICAvLyAtLS0tLVxuICAvLyAyIHwgM1xuICB0aGlzLnF1YWQwID0gbnVsbDtcbiAgdGhpcy5xdWFkMSA9IG51bGw7XG4gIHRoaXMucXVhZDIgPSBudWxsO1xuICB0aGlzLnF1YWQzID0gbnVsbDtcblxuICAvLyBUb3RhbCBtYXNzIG9mIGN1cnJlbnQgbm9kZVxuICB0aGlzLm1hc3MgPSAwO1xuXG4gIC8vIENlbnRlciBvZiBtYXNzIGNvb3JkaW5hdGVzXG4gIHRoaXMubWFzc1ggPSAwO1xuICB0aGlzLm1hc3NZID0gMDtcblxuICAvLyBib3VuZGluZyBib3ggY29vcmRpbmF0ZXNcbiAgdGhpcy5sZWZ0ID0gMDtcbiAgdGhpcy50b3AgPSAwO1xuICB0aGlzLmJvdHRvbSA9IDA7XG4gIHRoaXMucmlnaHQgPSAwO1xufTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICByYW5kb206IHJhbmRvbSxcbiAgcmFuZG9tSXRlcmF0b3I6IHJhbmRvbUl0ZXJhdG9yXG59O1xuXG4vKipcbiAqIENyZWF0ZXMgc2VlZGVkIFBSTkcgd2l0aCB0d28gbWV0aG9kczpcbiAqICAgbmV4dCgpIGFuZCBuZXh0RG91YmxlKClcbiAqL1xuZnVuY3Rpb24gcmFuZG9tKGlucHV0U2VlZCkge1xuICB2YXIgc2VlZCA9IHR5cGVvZiBpbnB1dFNlZWQgPT09ICdudW1iZXInID8gaW5wdXRTZWVkIDogKCsgbmV3IERhdGUoKSk7XG4gIHZhciByYW5kb21GdW5jID0gZnVuY3Rpb24oKSB7XG4gICAgICAvLyBSb2JlcnQgSmVua2lucycgMzIgYml0IGludGVnZXIgaGFzaCBmdW5jdGlvbi5cbiAgICAgIHNlZWQgPSAoKHNlZWQgKyAweDdlZDU1ZDE2KSArIChzZWVkIDw8IDEyKSkgICYgMHhmZmZmZmZmZjtcbiAgICAgIHNlZWQgPSAoKHNlZWQgXiAweGM3NjFjMjNjKSBeIChzZWVkID4+PiAxOSkpICYgMHhmZmZmZmZmZjtcbiAgICAgIHNlZWQgPSAoKHNlZWQgKyAweDE2NTY2N2IxKSArIChzZWVkIDw8IDUpKSAgICYgMHhmZmZmZmZmZjtcbiAgICAgIHNlZWQgPSAoKHNlZWQgKyAweGQzYTI2NDZjKSBeIChzZWVkIDw8IDkpKSAgICYgMHhmZmZmZmZmZjtcbiAgICAgIHNlZWQgPSAoKHNlZWQgKyAweGZkNzA0NmM1KSArIChzZWVkIDw8IDMpKSAgICYgMHhmZmZmZmZmZjtcbiAgICAgIHNlZWQgPSAoKHNlZWQgXiAweGI1NWE0ZjA5KSBeIChzZWVkID4+PiAxNikpICYgMHhmZmZmZmZmZjtcbiAgICAgIHJldHVybiAoc2VlZCAmIDB4ZmZmZmZmZikgLyAweDEwMDAwMDAwO1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgICAvKipcbiAgICAgICAqIEdlbmVyYXRlcyByYW5kb20gaW50ZWdlciBudW1iZXIgaW4gdGhlIHJhbmdlIGZyb20gMCAoaW5jbHVzaXZlKSB0byBtYXhWYWx1ZSAoZXhjbHVzaXZlKVxuICAgICAgICpcbiAgICAgICAqIEBwYXJhbSBtYXhWYWx1ZSBOdW1iZXIgUkVRVUlSRUQuIE9tbWl0dGluZyB0aGlzIG51bWJlciB3aWxsIHJlc3VsdCBpbiBOYU4gdmFsdWVzIGZyb20gUFJORy5cbiAgICAgICAqL1xuICAgICAgbmV4dCA6IGZ1bmN0aW9uIChtYXhWYWx1ZSkge1xuICAgICAgICAgIHJldHVybiBNYXRoLmZsb29yKHJhbmRvbUZ1bmMoKSAqIG1heFZhbHVlKTtcbiAgICAgIH0sXG5cbiAgICAgIC8qKlxuICAgICAgICogR2VuZXJhdGVzIHJhbmRvbSBkb3VibGUgbnVtYmVyIGluIHRoZSByYW5nZSBmcm9tIDAgKGluY2x1c2l2ZSkgdG8gMSAoZXhjbHVzaXZlKVxuICAgICAgICogVGhpcyBmdW5jdGlvbiBpcyB0aGUgc2FtZSBhcyBNYXRoLnJhbmRvbSgpIChleGNlcHQgdGhhdCBpdCBjb3VsZCBiZSBzZWVkZWQpXG4gICAgICAgKi9cbiAgICAgIG5leHREb3VibGUgOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmV0dXJuIHJhbmRvbUZ1bmMoKTtcbiAgICAgIH1cbiAgfTtcbn1cblxuLypcbiAqIENyZWF0ZXMgaXRlcmF0b3Igb3ZlciBhcnJheSwgd2hpY2ggcmV0dXJucyBpdGVtcyBvZiBhcnJheSBpbiByYW5kb20gb3JkZXJcbiAqIFRpbWUgY29tcGxleGl0eSBpcyBndWFyYW50ZWVkIHRvIGJlIE8obik7XG4gKi9cbmZ1bmN0aW9uIHJhbmRvbUl0ZXJhdG9yKGFycmF5LCBjdXN0b21SYW5kb20pIHtcbiAgICB2YXIgbG9jYWxSYW5kb20gPSBjdXN0b21SYW5kb20gfHwgcmFuZG9tKCk7XG4gICAgaWYgKHR5cGVvZiBsb2NhbFJhbmRvbS5uZXh0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2N1c3RvbVJhbmRvbSBkb2VzIG5vdCBtYXRjaCBleHBlY3RlZCBBUEk6IG5leHQoKSBmdW5jdGlvbiBpcyBtaXNzaW5nJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZm9yRWFjaCA6IGZ1bmN0aW9uIChjYWxsYmFjaykge1xuICAgICAgICAgICAgdmFyIGksIGosIHQ7XG4gICAgICAgICAgICBmb3IgKGkgPSBhcnJheS5sZW5ndGggLSAxOyBpID4gMDsgLS1pKSB7XG4gICAgICAgICAgICAgICAgaiA9IGxvY2FsUmFuZG9tLm5leHQoaSArIDEpOyAvLyBpIGluY2x1c2l2ZVxuICAgICAgICAgICAgICAgIHQgPSBhcnJheVtqXTtcbiAgICAgICAgICAgICAgICBhcnJheVtqXSA9IGFycmF5W2ldO1xuICAgICAgICAgICAgICAgIGFycmF5W2ldID0gdDtcblxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHQpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoYXJyYXkubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soYXJyYXlbMF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTaHVmZmxlcyBhcnJheSByYW5kb21seSwgaW4gcGxhY2UuXG4gICAgICAgICAqL1xuICAgICAgICBzaHVmZmxlIDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGksIGosIHQ7XG4gICAgICAgICAgICBmb3IgKGkgPSBhcnJheS5sZW5ndGggLSAxOyBpID4gMDsgLS1pKSB7XG4gICAgICAgICAgICAgICAgaiA9IGxvY2FsUmFuZG9tLm5leHQoaSArIDEpOyAvLyBpIGluY2x1c2l2ZVxuICAgICAgICAgICAgICAgIHQgPSBhcnJheVtqXTtcbiAgICAgICAgICAgICAgICBhcnJheVtqXSA9IGFycmF5W2ldO1xuICAgICAgICAgICAgICAgIGFycmF5W2ldID0gdDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGFycmF5O1xuICAgICAgICB9XG4gICAgfTtcbn1cbiIsIi8vICAgICBVbmRlcnNjb3JlLmpzIDEuOC4zXG4vLyAgICAgaHR0cDovL3VuZGVyc2NvcmVqcy5vcmdcbi8vICAgICAoYykgMjAwOS0yMDE1IEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBhbmQgSW52ZXN0aWdhdGl2ZSBSZXBvcnRlcnMgJiBFZGl0b3JzXG4vLyAgICAgVW5kZXJzY29yZSBtYXkgYmUgZnJlZWx5IGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cblxuKGZ1bmN0aW9uKCkge1xuXG4gIC8vIEJhc2VsaW5lIHNldHVwXG4gIC8vIC0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gRXN0YWJsaXNoIHRoZSByb290IG9iamVjdCwgYHdpbmRvd2AgaW4gdGhlIGJyb3dzZXIsIG9yIGBleHBvcnRzYCBvbiB0aGUgc2VydmVyLlxuICB2YXIgcm9vdCA9IHRoaXM7XG5cbiAgLy8gU2F2ZSB0aGUgcHJldmlvdXMgdmFsdWUgb2YgdGhlIGBfYCB2YXJpYWJsZS5cbiAgdmFyIHByZXZpb3VzVW5kZXJzY29yZSA9IHJvb3QuXztcblxuICAvLyBTYXZlIGJ5dGVzIGluIHRoZSBtaW5pZmllZCAoYnV0IG5vdCBnemlwcGVkKSB2ZXJzaW9uOlxuICB2YXIgQXJyYXlQcm90byA9IEFycmF5LnByb3RvdHlwZSwgT2JqUHJvdG8gPSBPYmplY3QucHJvdG90eXBlLCBGdW5jUHJvdG8gPSBGdW5jdGlvbi5wcm90b3R5cGU7XG5cbiAgLy8gQ3JlYXRlIHF1aWNrIHJlZmVyZW5jZSB2YXJpYWJsZXMgZm9yIHNwZWVkIGFjY2VzcyB0byBjb3JlIHByb3RvdHlwZXMuXG4gIHZhclxuICAgIHB1c2ggICAgICAgICAgICAgPSBBcnJheVByb3RvLnB1c2gsXG4gICAgc2xpY2UgICAgICAgICAgICA9IEFycmF5UHJvdG8uc2xpY2UsXG4gICAgdG9TdHJpbmcgICAgICAgICA9IE9ialByb3RvLnRvU3RyaW5nLFxuICAgIGhhc093blByb3BlcnR5ICAgPSBPYmpQcm90by5oYXNPd25Qcm9wZXJ0eTtcblxuICAvLyBBbGwgKipFQ01BU2NyaXB0IDUqKiBuYXRpdmUgZnVuY3Rpb24gaW1wbGVtZW50YXRpb25zIHRoYXQgd2UgaG9wZSB0byB1c2VcbiAgLy8gYXJlIGRlY2xhcmVkIGhlcmUuXG4gIHZhclxuICAgIG5hdGl2ZUlzQXJyYXkgICAgICA9IEFycmF5LmlzQXJyYXksXG4gICAgbmF0aXZlS2V5cyAgICAgICAgID0gT2JqZWN0LmtleXMsXG4gICAgbmF0aXZlQmluZCAgICAgICAgID0gRnVuY1Byb3RvLmJpbmQsXG4gICAgbmF0aXZlQ3JlYXRlICAgICAgID0gT2JqZWN0LmNyZWF0ZTtcblxuICAvLyBOYWtlZCBmdW5jdGlvbiByZWZlcmVuY2UgZm9yIHN1cnJvZ2F0ZS1wcm90b3R5cGUtc3dhcHBpbmcuXG4gIHZhciBDdG9yID0gZnVuY3Rpb24oKXt9O1xuXG4gIC8vIENyZWF0ZSBhIHNhZmUgcmVmZXJlbmNlIHRvIHRoZSBVbmRlcnNjb3JlIG9iamVjdCBmb3IgdXNlIGJlbG93LlxuICB2YXIgXyA9IGZ1bmN0aW9uKG9iaikge1xuICAgIGlmIChvYmogaW5zdGFuY2VvZiBfKSByZXR1cm4gb2JqO1xuICAgIGlmICghKHRoaXMgaW5zdGFuY2VvZiBfKSkgcmV0dXJuIG5ldyBfKG9iaik7XG4gICAgdGhpcy5fd3JhcHBlZCA9IG9iajtcbiAgfTtcblxuICAvLyBFeHBvcnQgdGhlIFVuZGVyc2NvcmUgb2JqZWN0IGZvciAqKk5vZGUuanMqKiwgd2l0aFxuICAvLyBiYWNrd2FyZHMtY29tcGF0aWJpbGl0eSBmb3IgdGhlIG9sZCBgcmVxdWlyZSgpYCBBUEkuIElmIHdlJ3JlIGluXG4gIC8vIHRoZSBicm93c2VyLCBhZGQgYF9gIGFzIGEgZ2xvYmFsIG9iamVjdC5cbiAgaWYgKHR5cGVvZiBleHBvcnRzICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykge1xuICAgICAgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gXztcbiAgICB9XG4gICAgZXhwb3J0cy5fID0gXztcbiAgfSBlbHNlIHtcbiAgICByb290Ll8gPSBfO1xuICB9XG5cbiAgLy8gQ3VycmVudCB2ZXJzaW9uLlxuICBfLlZFUlNJT04gPSAnMS44LjMnO1xuXG4gIC8vIEludGVybmFsIGZ1bmN0aW9uIHRoYXQgcmV0dXJucyBhbiBlZmZpY2llbnQgKGZvciBjdXJyZW50IGVuZ2luZXMpIHZlcnNpb25cbiAgLy8gb2YgdGhlIHBhc3NlZC1pbiBjYWxsYmFjaywgdG8gYmUgcmVwZWF0ZWRseSBhcHBsaWVkIGluIG90aGVyIFVuZGVyc2NvcmVcbiAgLy8gZnVuY3Rpb25zLlxuICB2YXIgb3B0aW1pemVDYiA9IGZ1bmN0aW9uKGZ1bmMsIGNvbnRleHQsIGFyZ0NvdW50KSB7XG4gICAgaWYgKGNvbnRleHQgPT09IHZvaWQgMCkgcmV0dXJuIGZ1bmM7XG4gICAgc3dpdGNoIChhcmdDb3VudCA9PSBudWxsID8gMyA6IGFyZ0NvdW50KSB7XG4gICAgICBjYXNlIDE6IHJldHVybiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICByZXR1cm4gZnVuYy5jYWxsKGNvbnRleHQsIHZhbHVlKTtcbiAgICAgIH07XG4gICAgICBjYXNlIDI6IHJldHVybiBmdW5jdGlvbih2YWx1ZSwgb3RoZXIpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmMuY2FsbChjb250ZXh0LCB2YWx1ZSwgb3RoZXIpO1xuICAgICAgfTtcbiAgICAgIGNhc2UgMzogcmV0dXJuIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgY29sbGVjdGlvbikge1xuICAgICAgICByZXR1cm4gZnVuYy5jYWxsKGNvbnRleHQsIHZhbHVlLCBpbmRleCwgY29sbGVjdGlvbik7XG4gICAgICB9O1xuICAgICAgY2FzZSA0OiByZXR1cm4gZnVuY3Rpb24oYWNjdW11bGF0b3IsIHZhbHVlLCBpbmRleCwgY29sbGVjdGlvbikge1xuICAgICAgICByZXR1cm4gZnVuYy5jYWxsKGNvbnRleHQsIGFjY3VtdWxhdG9yLCB2YWx1ZSwgaW5kZXgsIGNvbGxlY3Rpb24pO1xuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGZ1bmMuYXBwbHkoY29udGV4dCwgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9O1xuXG4gIC8vIEEgbW9zdGx5LWludGVybmFsIGZ1bmN0aW9uIHRvIGdlbmVyYXRlIGNhbGxiYWNrcyB0aGF0IGNhbiBiZSBhcHBsaWVkXG4gIC8vIHRvIGVhY2ggZWxlbWVudCBpbiBhIGNvbGxlY3Rpb24sIHJldHVybmluZyB0aGUgZGVzaXJlZCByZXN1bHQg4oCUIGVpdGhlclxuICAvLyBpZGVudGl0eSwgYW4gYXJiaXRyYXJ5IGNhbGxiYWNrLCBhIHByb3BlcnR5IG1hdGNoZXIsIG9yIGEgcHJvcGVydHkgYWNjZXNzb3IuXG4gIHZhciBjYiA9IGZ1bmN0aW9uKHZhbHVlLCBjb250ZXh0LCBhcmdDb3VudCkge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gXy5pZGVudGl0eTtcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKHZhbHVlKSkgcmV0dXJuIG9wdGltaXplQ2IodmFsdWUsIGNvbnRleHQsIGFyZ0NvdW50KTtcbiAgICBpZiAoXy5pc09iamVjdCh2YWx1ZSkpIHJldHVybiBfLm1hdGNoZXIodmFsdWUpO1xuICAgIHJldHVybiBfLnByb3BlcnR5KHZhbHVlKTtcbiAgfTtcbiAgXy5pdGVyYXRlZSA9IGZ1bmN0aW9uKHZhbHVlLCBjb250ZXh0KSB7XG4gICAgcmV0dXJuIGNiKHZhbHVlLCBjb250ZXh0LCBJbmZpbml0eSk7XG4gIH07XG5cbiAgLy8gQW4gaW50ZXJuYWwgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGFzc2lnbmVyIGZ1bmN0aW9ucy5cbiAgdmFyIGNyZWF0ZUFzc2lnbmVyID0gZnVuY3Rpb24oa2V5c0Z1bmMsIHVuZGVmaW5lZE9ubHkpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqKSB7XG4gICAgICB2YXIgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgIGlmIChsZW5ndGggPCAyIHx8IG9iaiA9PSBudWxsKSByZXR1cm4gb2JqO1xuICAgICAgZm9yICh2YXIgaW5kZXggPSAxOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICB2YXIgc291cmNlID0gYXJndW1lbnRzW2luZGV4XSxcbiAgICAgICAgICAgIGtleXMgPSBrZXlzRnVuYyhzb3VyY2UpLFxuICAgICAgICAgICAgbCA9IGtleXMubGVuZ3RoO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgICAgIGlmICghdW5kZWZpbmVkT25seSB8fCBvYmpba2V5XSA9PT0gdm9pZCAwKSBvYmpba2V5XSA9IHNvdXJjZVtrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH07XG4gIH07XG5cbiAgLy8gQW4gaW50ZXJuYWwgZnVuY3Rpb24gZm9yIGNyZWF0aW5nIGEgbmV3IG9iamVjdCB0aGF0IGluaGVyaXRzIGZyb20gYW5vdGhlci5cbiAgdmFyIGJhc2VDcmVhdGUgPSBmdW5jdGlvbihwcm90b3R5cGUpIHtcbiAgICBpZiAoIV8uaXNPYmplY3QocHJvdG90eXBlKSkgcmV0dXJuIHt9O1xuICAgIGlmIChuYXRpdmVDcmVhdGUpIHJldHVybiBuYXRpdmVDcmVhdGUocHJvdG90eXBlKTtcbiAgICBDdG9yLnByb3RvdHlwZSA9IHByb3RvdHlwZTtcbiAgICB2YXIgcmVzdWx0ID0gbmV3IEN0b3I7XG4gICAgQ3Rvci5wcm90b3R5cGUgPSBudWxsO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgdmFyIHByb3BlcnR5ID0gZnVuY3Rpb24oa2V5KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKG9iaikge1xuICAgICAgcmV0dXJuIG9iaiA9PSBudWxsID8gdm9pZCAwIDogb2JqW2tleV07XG4gICAgfTtcbiAgfTtcblxuICAvLyBIZWxwZXIgZm9yIGNvbGxlY3Rpb24gbWV0aG9kcyB0byBkZXRlcm1pbmUgd2hldGhlciBhIGNvbGxlY3Rpb25cbiAgLy8gc2hvdWxkIGJlIGl0ZXJhdGVkIGFzIGFuIGFycmF5IG9yIGFzIGFuIG9iamVjdFxuICAvLyBSZWxhdGVkOiBodHRwOi8vcGVvcGxlLm1vemlsbGEub3JnL35qb3JlbmRvcmZmL2VzNi1kcmFmdC5odG1sI3NlYy10b2xlbmd0aFxuICAvLyBBdm9pZHMgYSB2ZXJ5IG5hc3R5IGlPUyA4IEpJVCBidWcgb24gQVJNLTY0LiAjMjA5NFxuICB2YXIgTUFYX0FSUkFZX0lOREVYID0gTWF0aC5wb3coMiwgNTMpIC0gMTtcbiAgdmFyIGdldExlbmd0aCA9IHByb3BlcnR5KCdsZW5ndGgnKTtcbiAgdmFyIGlzQXJyYXlMaWtlID0gZnVuY3Rpb24oY29sbGVjdGlvbikge1xuICAgIHZhciBsZW5ndGggPSBnZXRMZW5ndGgoY29sbGVjdGlvbik7XG4gICAgcmV0dXJuIHR5cGVvZiBsZW5ndGggPT0gJ251bWJlcicgJiYgbGVuZ3RoID49IDAgJiYgbGVuZ3RoIDw9IE1BWF9BUlJBWV9JTkRFWDtcbiAgfTtcblxuICAvLyBDb2xsZWN0aW9uIEZ1bmN0aW9uc1xuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8vIFRoZSBjb3JuZXJzdG9uZSwgYW4gYGVhY2hgIGltcGxlbWVudGF0aW9uLCBha2EgYGZvckVhY2hgLlxuICAvLyBIYW5kbGVzIHJhdyBvYmplY3RzIGluIGFkZGl0aW9uIHRvIGFycmF5LWxpa2VzLiBUcmVhdHMgYWxsXG4gIC8vIHNwYXJzZSBhcnJheS1saWtlcyBhcyBpZiB0aGV5IHdlcmUgZGVuc2UuXG4gIF8uZWFjaCA9IF8uZm9yRWFjaCA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICBpdGVyYXRlZSA9IG9wdGltaXplQ2IoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgIHZhciBpLCBsZW5ndGg7XG4gICAgaWYgKGlzQXJyYXlMaWtlKG9iaikpIHtcbiAgICAgIGZvciAoaSA9IDAsIGxlbmd0aCA9IG9iai5sZW5ndGg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICBpdGVyYXRlZShvYmpbaV0sIGksIG9iaik7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaik7XG4gICAgICBmb3IgKGkgPSAwLCBsZW5ndGggPSBrZXlzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGl0ZXJhdGVlKG9ialtrZXlzW2ldXSwga2V5c1tpXSwgb2JqKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfTtcblxuICAvLyBSZXR1cm4gdGhlIHJlc3VsdHMgb2YgYXBwbHlpbmcgdGhlIGl0ZXJhdGVlIHRvIGVhY2ggZWxlbWVudC5cbiAgXy5tYXAgPSBfLmNvbGxlY3QgPSBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaXRlcmF0ZWUgPSBjYihpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgdmFyIGtleXMgPSAhaXNBcnJheUxpa2Uob2JqKSAmJiBfLmtleXMob2JqKSxcbiAgICAgICAgbGVuZ3RoID0gKGtleXMgfHwgb2JqKS5sZW5ndGgsXG4gICAgICAgIHJlc3VsdHMgPSBBcnJheShsZW5ndGgpO1xuICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggPCBsZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIHZhciBjdXJyZW50S2V5ID0ga2V5cyA/IGtleXNbaW5kZXhdIDogaW5kZXg7XG4gICAgICByZXN1bHRzW2luZGV4XSA9IGl0ZXJhdGVlKG9ialtjdXJyZW50S2V5XSwgY3VycmVudEtleSwgb2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdHM7XG4gIH07XG5cbiAgLy8gQ3JlYXRlIGEgcmVkdWNpbmcgZnVuY3Rpb24gaXRlcmF0aW5nIGxlZnQgb3IgcmlnaHQuXG4gIGZ1bmN0aW9uIGNyZWF0ZVJlZHVjZShkaXIpIHtcbiAgICAvLyBPcHRpbWl6ZWQgaXRlcmF0b3IgZnVuY3Rpb24gYXMgdXNpbmcgYXJndW1lbnRzLmxlbmd0aFxuICAgIC8vIGluIHRoZSBtYWluIGZ1bmN0aW9uIHdpbGwgZGVvcHRpbWl6ZSB0aGUsIHNlZSAjMTk5MS5cbiAgICBmdW5jdGlvbiBpdGVyYXRvcihvYmosIGl0ZXJhdGVlLCBtZW1vLCBrZXlzLCBpbmRleCwgbGVuZ3RoKSB7XG4gICAgICBmb3IgKDsgaW5kZXggPj0gMCAmJiBpbmRleCA8IGxlbmd0aDsgaW5kZXggKz0gZGlyKSB7XG4gICAgICAgIHZhciBjdXJyZW50S2V5ID0ga2V5cyA/IGtleXNbaW5kZXhdIDogaW5kZXg7XG4gICAgICAgIG1lbW8gPSBpdGVyYXRlZShtZW1vLCBvYmpbY3VycmVudEtleV0sIGN1cnJlbnRLZXksIG9iaik7XG4gICAgICB9XG4gICAgICByZXR1cm4gbWVtbztcbiAgICB9XG5cbiAgICByZXR1cm4gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgbWVtbywgY29udGV4dCkge1xuICAgICAgaXRlcmF0ZWUgPSBvcHRpbWl6ZUNiKGl0ZXJhdGVlLCBjb250ZXh0LCA0KTtcbiAgICAgIHZhciBrZXlzID0gIWlzQXJyYXlMaWtlKG9iaikgJiYgXy5rZXlzKG9iaiksXG4gICAgICAgICAgbGVuZ3RoID0gKGtleXMgfHwgb2JqKS5sZW5ndGgsXG4gICAgICAgICAgaW5kZXggPSBkaXIgPiAwID8gMCA6IGxlbmd0aCAtIDE7XG4gICAgICAvLyBEZXRlcm1pbmUgdGhlIGluaXRpYWwgdmFsdWUgaWYgbm9uZSBpcyBwcm92aWRlZC5cbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMykge1xuICAgICAgICBtZW1vID0gb2JqW2tleXMgPyBrZXlzW2luZGV4XSA6IGluZGV4XTtcbiAgICAgICAgaW5kZXggKz0gZGlyO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGl0ZXJhdG9yKG9iaiwgaXRlcmF0ZWUsIG1lbW8sIGtleXMsIGluZGV4LCBsZW5ndGgpO1xuICAgIH07XG4gIH1cblxuICAvLyAqKlJlZHVjZSoqIGJ1aWxkcyB1cCBhIHNpbmdsZSByZXN1bHQgZnJvbSBhIGxpc3Qgb2YgdmFsdWVzLCBha2EgYGluamVjdGAsXG4gIC8vIG9yIGBmb2xkbGAuXG4gIF8ucmVkdWNlID0gXy5mb2xkbCA9IF8uaW5qZWN0ID0gY3JlYXRlUmVkdWNlKDEpO1xuXG4gIC8vIFRoZSByaWdodC1hc3NvY2lhdGl2ZSB2ZXJzaW9uIG9mIHJlZHVjZSwgYWxzbyBrbm93biBhcyBgZm9sZHJgLlxuICBfLnJlZHVjZVJpZ2h0ID0gXy5mb2xkciA9IGNyZWF0ZVJlZHVjZSgtMSk7XG5cbiAgLy8gUmV0dXJuIHRoZSBmaXJzdCB2YWx1ZSB3aGljaCBwYXNzZXMgYSB0cnV0aCB0ZXN0LiBBbGlhc2VkIGFzIGBkZXRlY3RgLlxuICBfLmZpbmQgPSBfLmRldGVjdCA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgdmFyIGtleTtcbiAgICBpZiAoaXNBcnJheUxpa2Uob2JqKSkge1xuICAgICAga2V5ID0gXy5maW5kSW5kZXgob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBrZXkgPSBfLmZpbmRLZXkob2JqLCBwcmVkaWNhdGUsIGNvbnRleHQpO1xuICAgIH1cbiAgICBpZiAoa2V5ICE9PSB2b2lkIDAgJiYga2V5ICE9PSAtMSkgcmV0dXJuIG9ialtrZXldO1xuICB9O1xuXG4gIC8vIFJldHVybiBhbGwgdGhlIGVsZW1lbnRzIHRoYXQgcGFzcyBhIHRydXRoIHRlc3QuXG4gIC8vIEFsaWFzZWQgYXMgYHNlbGVjdGAuXG4gIF8uZmlsdGVyID0gXy5zZWxlY3QgPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHZhciByZXN1bHRzID0gW107XG4gICAgcHJlZGljYXRlID0gY2IocHJlZGljYXRlLCBjb250ZXh0KTtcbiAgICBfLmVhY2gob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGxpc3QpIHtcbiAgICAgIGlmIChwcmVkaWNhdGUodmFsdWUsIGluZGV4LCBsaXN0KSkgcmVzdWx0cy5wdXNoKHZhbHVlKTtcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0cztcbiAgfTtcblxuICAvLyBSZXR1cm4gYWxsIHRoZSBlbGVtZW50cyBmb3Igd2hpY2ggYSB0cnV0aCB0ZXN0IGZhaWxzLlxuICBfLnJlamVjdCA9IGZ1bmN0aW9uKG9iaiwgcHJlZGljYXRlLCBjb250ZXh0KSB7XG4gICAgcmV0dXJuIF8uZmlsdGVyKG9iaiwgXy5uZWdhdGUoY2IocHJlZGljYXRlKSksIGNvbnRleHQpO1xuICB9O1xuXG4gIC8vIERldGVybWluZSB3aGV0aGVyIGFsbCBvZiB0aGUgZWxlbWVudHMgbWF0Y2ggYSB0cnV0aCB0ZXN0LlxuICAvLyBBbGlhc2VkIGFzIGBhbGxgLlxuICBfLmV2ZXJ5ID0gXy5hbGwgPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHByZWRpY2F0ZSA9IGNiKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgdmFyIGtleXMgPSAhaXNBcnJheUxpa2Uob2JqKSAmJiBfLmtleXMob2JqKSxcbiAgICAgICAgbGVuZ3RoID0gKGtleXMgfHwgb2JqKS5sZW5ndGg7XG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgdmFyIGN1cnJlbnRLZXkgPSBrZXlzID8ga2V5c1tpbmRleF0gOiBpbmRleDtcbiAgICAgIGlmICghcHJlZGljYXRlKG9ialtjdXJyZW50S2V5XSwgY3VycmVudEtleSwgb2JqKSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICAvLyBEZXRlcm1pbmUgaWYgYXQgbGVhc3Qgb25lIGVsZW1lbnQgaW4gdGhlIG9iamVjdCBtYXRjaGVzIGEgdHJ1dGggdGVzdC5cbiAgLy8gQWxpYXNlZCBhcyBgYW55YC5cbiAgXy5zb21lID0gXy5hbnkgPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHByZWRpY2F0ZSA9IGNiKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgdmFyIGtleXMgPSAhaXNBcnJheUxpa2Uob2JqKSAmJiBfLmtleXMob2JqKSxcbiAgICAgICAgbGVuZ3RoID0gKGtleXMgfHwgb2JqKS5sZW5ndGg7XG4gICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgdmFyIGN1cnJlbnRLZXkgPSBrZXlzID8ga2V5c1tpbmRleF0gOiBpbmRleDtcbiAgICAgIGlmIChwcmVkaWNhdGUob2JqW2N1cnJlbnRLZXldLCBjdXJyZW50S2V5LCBvYmopKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIC8vIERldGVybWluZSBpZiB0aGUgYXJyYXkgb3Igb2JqZWN0IGNvbnRhaW5zIGEgZ2l2ZW4gaXRlbSAodXNpbmcgYD09PWApLlxuICAvLyBBbGlhc2VkIGFzIGBpbmNsdWRlc2AgYW5kIGBpbmNsdWRlYC5cbiAgXy5jb250YWlucyA9IF8uaW5jbHVkZXMgPSBfLmluY2x1ZGUgPSBmdW5jdGlvbihvYmosIGl0ZW0sIGZyb21JbmRleCwgZ3VhcmQpIHtcbiAgICBpZiAoIWlzQXJyYXlMaWtlKG9iaikpIG9iaiA9IF8udmFsdWVzKG9iaik7XG4gICAgaWYgKHR5cGVvZiBmcm9tSW5kZXggIT0gJ251bWJlcicgfHwgZ3VhcmQpIGZyb21JbmRleCA9IDA7XG4gICAgcmV0dXJuIF8uaW5kZXhPZihvYmosIGl0ZW0sIGZyb21JbmRleCkgPj0gMDtcbiAgfTtcblxuICAvLyBJbnZva2UgYSBtZXRob2QgKHdpdGggYXJndW1lbnRzKSBvbiBldmVyeSBpdGVtIGluIGEgY29sbGVjdGlvbi5cbiAgXy5pbnZva2UgPSBmdW5jdGlvbihvYmosIG1ldGhvZCkge1xuICAgIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpO1xuICAgIHZhciBpc0Z1bmMgPSBfLmlzRnVuY3Rpb24obWV0aG9kKTtcbiAgICByZXR1cm4gXy5tYXAob2JqLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgdmFyIGZ1bmMgPSBpc0Z1bmMgPyBtZXRob2QgOiB2YWx1ZVttZXRob2RdO1xuICAgICAgcmV0dXJuIGZ1bmMgPT0gbnVsbCA/IGZ1bmMgOiBmdW5jLmFwcGx5KHZhbHVlLCBhcmdzKTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBDb252ZW5pZW5jZSB2ZXJzaW9uIG9mIGEgY29tbW9uIHVzZSBjYXNlIG9mIGBtYXBgOiBmZXRjaGluZyBhIHByb3BlcnR5LlxuICBfLnBsdWNrID0gZnVuY3Rpb24ob2JqLCBrZXkpIHtcbiAgICByZXR1cm4gXy5tYXAob2JqLCBfLnByb3BlcnR5KGtleSkpO1xuICB9O1xuXG4gIC8vIENvbnZlbmllbmNlIHZlcnNpb24gb2YgYSBjb21tb24gdXNlIGNhc2Ugb2YgYGZpbHRlcmA6IHNlbGVjdGluZyBvbmx5IG9iamVjdHNcbiAgLy8gY29udGFpbmluZyBzcGVjaWZpYyBga2V5OnZhbHVlYCBwYWlycy5cbiAgXy53aGVyZSA9IGZ1bmN0aW9uKG9iaiwgYXR0cnMpIHtcbiAgICByZXR1cm4gXy5maWx0ZXIob2JqLCBfLm1hdGNoZXIoYXR0cnMpKTtcbiAgfTtcblxuICAvLyBDb252ZW5pZW5jZSB2ZXJzaW9uIG9mIGEgY29tbW9uIHVzZSBjYXNlIG9mIGBmaW5kYDogZ2V0dGluZyB0aGUgZmlyc3Qgb2JqZWN0XG4gIC8vIGNvbnRhaW5pbmcgc3BlY2lmaWMgYGtleTp2YWx1ZWAgcGFpcnMuXG4gIF8uZmluZFdoZXJlID0gZnVuY3Rpb24ob2JqLCBhdHRycykge1xuICAgIHJldHVybiBfLmZpbmQob2JqLCBfLm1hdGNoZXIoYXR0cnMpKTtcbiAgfTtcblxuICAvLyBSZXR1cm4gdGhlIG1heGltdW0gZWxlbWVudCAob3IgZWxlbWVudC1iYXNlZCBjb21wdXRhdGlvbikuXG4gIF8ubWF4ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIHZhciByZXN1bHQgPSAtSW5maW5pdHksIGxhc3RDb21wdXRlZCA9IC1JbmZpbml0eSxcbiAgICAgICAgdmFsdWUsIGNvbXB1dGVkO1xuICAgIGlmIChpdGVyYXRlZSA9PSBudWxsICYmIG9iaiAhPSBudWxsKSB7XG4gICAgICBvYmogPSBpc0FycmF5TGlrZShvYmopID8gb2JqIDogXy52YWx1ZXMob2JqKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBvYmoubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFsdWUgPSBvYmpbaV07XG4gICAgICAgIGlmICh2YWx1ZSA+IHJlc3VsdCkge1xuICAgICAgICAgIHJlc3VsdCA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGl0ZXJhdGVlID0gY2IoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgICAgXy5lYWNoKG9iaiwgZnVuY3Rpb24odmFsdWUsIGluZGV4LCBsaXN0KSB7XG4gICAgICAgIGNvbXB1dGVkID0gaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBsaXN0KTtcbiAgICAgICAgaWYgKGNvbXB1dGVkID4gbGFzdENvbXB1dGVkIHx8IGNvbXB1dGVkID09PSAtSW5maW5pdHkgJiYgcmVzdWx0ID09PSAtSW5maW5pdHkpIHtcbiAgICAgICAgICByZXN1bHQgPSB2YWx1ZTtcbiAgICAgICAgICBsYXN0Q29tcHV0ZWQgPSBjb21wdXRlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSBtaW5pbXVtIGVsZW1lbnQgKG9yIGVsZW1lbnQtYmFzZWQgY29tcHV0YXRpb24pLlxuICBfLm1pbiA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICB2YXIgcmVzdWx0ID0gSW5maW5pdHksIGxhc3RDb21wdXRlZCA9IEluZmluaXR5LFxuICAgICAgICB2YWx1ZSwgY29tcHV0ZWQ7XG4gICAgaWYgKGl0ZXJhdGVlID09IG51bGwgJiYgb2JqICE9IG51bGwpIHtcbiAgICAgIG9iaiA9IGlzQXJyYXlMaWtlKG9iaikgPyBvYmogOiBfLnZhbHVlcyhvYmopO1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IG9iai5sZW5ndGg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICB2YWx1ZSA9IG9ialtpXTtcbiAgICAgICAgaWYgKHZhbHVlIDwgcmVzdWx0KSB7XG4gICAgICAgICAgcmVzdWx0ID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaXRlcmF0ZWUgPSBjYihpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgICBfLmVhY2gob2JqLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGxpc3QpIHtcbiAgICAgICAgY29tcHV0ZWQgPSBpdGVyYXRlZSh2YWx1ZSwgaW5kZXgsIGxpc3QpO1xuICAgICAgICBpZiAoY29tcHV0ZWQgPCBsYXN0Q29tcHV0ZWQgfHwgY29tcHV0ZWQgPT09IEluZmluaXR5ICYmIHJlc3VsdCA9PT0gSW5maW5pdHkpIHtcbiAgICAgICAgICByZXN1bHQgPSB2YWx1ZTtcbiAgICAgICAgICBsYXN0Q29tcHV0ZWQgPSBjb21wdXRlZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gU2h1ZmZsZSBhIGNvbGxlY3Rpb24sIHVzaW5nIHRoZSBtb2Rlcm4gdmVyc2lvbiBvZiB0aGVcbiAgLy8gW0Zpc2hlci1ZYXRlcyBzaHVmZmxlXShodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0Zpc2hlcuKAk1lhdGVzX3NodWZmbGUpLlxuICBfLnNodWZmbGUgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgc2V0ID0gaXNBcnJheUxpa2Uob2JqKSA/IG9iaiA6IF8udmFsdWVzKG9iaik7XG4gICAgdmFyIGxlbmd0aCA9IHNldC5sZW5ndGg7XG4gICAgdmFyIHNodWZmbGVkID0gQXJyYXkobGVuZ3RoKTtcbiAgICBmb3IgKHZhciBpbmRleCA9IDAsIHJhbmQ7IGluZGV4IDwgbGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICByYW5kID0gXy5yYW5kb20oMCwgaW5kZXgpO1xuICAgICAgaWYgKHJhbmQgIT09IGluZGV4KSBzaHVmZmxlZFtpbmRleF0gPSBzaHVmZmxlZFtyYW5kXTtcbiAgICAgIHNodWZmbGVkW3JhbmRdID0gc2V0W2luZGV4XTtcbiAgICB9XG4gICAgcmV0dXJuIHNodWZmbGVkO1xuICB9O1xuXG4gIC8vIFNhbXBsZSAqKm4qKiByYW5kb20gdmFsdWVzIGZyb20gYSBjb2xsZWN0aW9uLlxuICAvLyBJZiAqKm4qKiBpcyBub3Qgc3BlY2lmaWVkLCByZXR1cm5zIGEgc2luZ2xlIHJhbmRvbSBlbGVtZW50LlxuICAvLyBUaGUgaW50ZXJuYWwgYGd1YXJkYCBhcmd1bWVudCBhbGxvd3MgaXQgdG8gd29yayB3aXRoIGBtYXBgLlxuICBfLnNhbXBsZSA9IGZ1bmN0aW9uKG9iaiwgbiwgZ3VhcmQpIHtcbiAgICBpZiAobiA9PSBudWxsIHx8IGd1YXJkKSB7XG4gICAgICBpZiAoIWlzQXJyYXlMaWtlKG9iaikpIG9iaiA9IF8udmFsdWVzKG9iaik7XG4gICAgICByZXR1cm4gb2JqW18ucmFuZG9tKG9iai5sZW5ndGggLSAxKV07XG4gICAgfVxuICAgIHJldHVybiBfLnNodWZmbGUob2JqKS5zbGljZSgwLCBNYXRoLm1heCgwLCBuKSk7XG4gIH07XG5cbiAgLy8gU29ydCB0aGUgb2JqZWN0J3MgdmFsdWVzIGJ5IGEgY3JpdGVyaW9uIHByb2R1Y2VkIGJ5IGFuIGl0ZXJhdGVlLlxuICBfLnNvcnRCeSA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICBpdGVyYXRlZSA9IGNiKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICByZXR1cm4gXy5wbHVjayhfLm1hcChvYmosIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgbGlzdCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdmFsdWU6IHZhbHVlLFxuICAgICAgICBpbmRleDogaW5kZXgsXG4gICAgICAgIGNyaXRlcmlhOiBpdGVyYXRlZSh2YWx1ZSwgaW5kZXgsIGxpc3QpXG4gICAgICB9O1xuICAgIH0pLnNvcnQoZnVuY3Rpb24obGVmdCwgcmlnaHQpIHtcbiAgICAgIHZhciBhID0gbGVmdC5jcml0ZXJpYTtcbiAgICAgIHZhciBiID0gcmlnaHQuY3JpdGVyaWE7XG4gICAgICBpZiAoYSAhPT0gYikge1xuICAgICAgICBpZiAoYSA+IGIgfHwgYSA9PT0gdm9pZCAwKSByZXR1cm4gMTtcbiAgICAgICAgaWYgKGEgPCBiIHx8IGIgPT09IHZvaWQgMCkgcmV0dXJuIC0xO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGxlZnQuaW5kZXggLSByaWdodC5pbmRleDtcbiAgICB9KSwgJ3ZhbHVlJyk7XG4gIH07XG5cbiAgLy8gQW4gaW50ZXJuYWwgZnVuY3Rpb24gdXNlZCBmb3IgYWdncmVnYXRlIFwiZ3JvdXAgYnlcIiBvcGVyYXRpb25zLlxuICB2YXIgZ3JvdXAgPSBmdW5jdGlvbihiZWhhdmlvcikge1xuICAgIHJldHVybiBmdW5jdGlvbihvYmosIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgICBpdGVyYXRlZSA9IGNiKGl0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICAgIF8uZWFjaChvYmosIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCkge1xuICAgICAgICB2YXIga2V5ID0gaXRlcmF0ZWUodmFsdWUsIGluZGV4LCBvYmopO1xuICAgICAgICBiZWhhdmlvcihyZXN1bHQsIHZhbHVlLCBrZXkpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gIH07XG5cbiAgLy8gR3JvdXBzIHRoZSBvYmplY3QncyB2YWx1ZXMgYnkgYSBjcml0ZXJpb24uIFBhc3MgZWl0aGVyIGEgc3RyaW5nIGF0dHJpYnV0ZVxuICAvLyB0byBncm91cCBieSwgb3IgYSBmdW5jdGlvbiB0aGF0IHJldHVybnMgdGhlIGNyaXRlcmlvbi5cbiAgXy5ncm91cEJ5ID0gZ3JvdXAoZnVuY3Rpb24ocmVzdWx0LCB2YWx1ZSwga2V5KSB7XG4gICAgaWYgKF8uaGFzKHJlc3VsdCwga2V5KSkgcmVzdWx0W2tleV0ucHVzaCh2YWx1ZSk7IGVsc2UgcmVzdWx0W2tleV0gPSBbdmFsdWVdO1xuICB9KTtcblxuICAvLyBJbmRleGVzIHRoZSBvYmplY3QncyB2YWx1ZXMgYnkgYSBjcml0ZXJpb24sIHNpbWlsYXIgdG8gYGdyb3VwQnlgLCBidXQgZm9yXG4gIC8vIHdoZW4geW91IGtub3cgdGhhdCB5b3VyIGluZGV4IHZhbHVlcyB3aWxsIGJlIHVuaXF1ZS5cbiAgXy5pbmRleEJ5ID0gZ3JvdXAoZnVuY3Rpb24ocmVzdWx0LCB2YWx1ZSwga2V5KSB7XG4gICAgcmVzdWx0W2tleV0gPSB2YWx1ZTtcbiAgfSk7XG5cbiAgLy8gQ291bnRzIGluc3RhbmNlcyBvZiBhbiBvYmplY3QgdGhhdCBncm91cCBieSBhIGNlcnRhaW4gY3JpdGVyaW9uLiBQYXNzXG4gIC8vIGVpdGhlciBhIHN0cmluZyBhdHRyaWJ1dGUgdG8gY291bnQgYnksIG9yIGEgZnVuY3Rpb24gdGhhdCByZXR1cm5zIHRoZVxuICAvLyBjcml0ZXJpb24uXG4gIF8uY291bnRCeSA9IGdyb3VwKGZ1bmN0aW9uKHJlc3VsdCwgdmFsdWUsIGtleSkge1xuICAgIGlmIChfLmhhcyhyZXN1bHQsIGtleSkpIHJlc3VsdFtrZXldKys7IGVsc2UgcmVzdWx0W2tleV0gPSAxO1xuICB9KTtcblxuICAvLyBTYWZlbHkgY3JlYXRlIGEgcmVhbCwgbGl2ZSBhcnJheSBmcm9tIGFueXRoaW5nIGl0ZXJhYmxlLlxuICBfLnRvQXJyYXkgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAoIW9iaikgcmV0dXJuIFtdO1xuICAgIGlmIChfLmlzQXJyYXkob2JqKSkgcmV0dXJuIHNsaWNlLmNhbGwob2JqKTtcbiAgICBpZiAoaXNBcnJheUxpa2Uob2JqKSkgcmV0dXJuIF8ubWFwKG9iaiwgXy5pZGVudGl0eSk7XG4gICAgcmV0dXJuIF8udmFsdWVzKG9iaik7XG4gIH07XG5cbiAgLy8gUmV0dXJuIHRoZSBudW1iZXIgb2YgZWxlbWVudHMgaW4gYW4gb2JqZWN0LlxuICBfLnNpemUgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAob2JqID09IG51bGwpIHJldHVybiAwO1xuICAgIHJldHVybiBpc0FycmF5TGlrZShvYmopID8gb2JqLmxlbmd0aCA6IF8ua2V5cyhvYmopLmxlbmd0aDtcbiAgfTtcblxuICAvLyBTcGxpdCBhIGNvbGxlY3Rpb24gaW50byB0d28gYXJyYXlzOiBvbmUgd2hvc2UgZWxlbWVudHMgYWxsIHNhdGlzZnkgdGhlIGdpdmVuXG4gIC8vIHByZWRpY2F0ZSwgYW5kIG9uZSB3aG9zZSBlbGVtZW50cyBhbGwgZG8gbm90IHNhdGlzZnkgdGhlIHByZWRpY2F0ZS5cbiAgXy5wYXJ0aXRpb24gPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHByZWRpY2F0ZSA9IGNiKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgdmFyIHBhc3MgPSBbXSwgZmFpbCA9IFtdO1xuICAgIF8uZWFjaChvYmosIGZ1bmN0aW9uKHZhbHVlLCBrZXksIG9iaikge1xuICAgICAgKHByZWRpY2F0ZSh2YWx1ZSwga2V5LCBvYmopID8gcGFzcyA6IGZhaWwpLnB1c2godmFsdWUpO1xuICAgIH0pO1xuICAgIHJldHVybiBbcGFzcywgZmFpbF07XG4gIH07XG5cbiAgLy8gQXJyYXkgRnVuY3Rpb25zXG4gIC8vIC0tLS0tLS0tLS0tLS0tLVxuXG4gIC8vIEdldCB0aGUgZmlyc3QgZWxlbWVudCBvZiBhbiBhcnJheS4gUGFzc2luZyAqKm4qKiB3aWxsIHJldHVybiB0aGUgZmlyc3QgTlxuICAvLyB2YWx1ZXMgaW4gdGhlIGFycmF5LiBBbGlhc2VkIGFzIGBoZWFkYCBhbmQgYHRha2VgLiBUaGUgKipndWFyZCoqIGNoZWNrXG4gIC8vIGFsbG93cyBpdCB0byB3b3JrIHdpdGggYF8ubWFwYC5cbiAgXy5maXJzdCA9IF8uaGVhZCA9IF8udGFrZSA9IGZ1bmN0aW9uKGFycmF5LCBuLCBndWFyZCkge1xuICAgIGlmIChhcnJheSA9PSBudWxsKSByZXR1cm4gdm9pZCAwO1xuICAgIGlmIChuID09IG51bGwgfHwgZ3VhcmQpIHJldHVybiBhcnJheVswXTtcbiAgICByZXR1cm4gXy5pbml0aWFsKGFycmF5LCBhcnJheS5sZW5ndGggLSBuKTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGV2ZXJ5dGhpbmcgYnV0IHRoZSBsYXN0IGVudHJ5IG9mIHRoZSBhcnJheS4gRXNwZWNpYWxseSB1c2VmdWwgb25cbiAgLy8gdGhlIGFyZ3VtZW50cyBvYmplY3QuIFBhc3NpbmcgKipuKiogd2lsbCByZXR1cm4gYWxsIHRoZSB2YWx1ZXMgaW5cbiAgLy8gdGhlIGFycmF5LCBleGNsdWRpbmcgdGhlIGxhc3QgTi5cbiAgXy5pbml0aWFsID0gZnVuY3Rpb24oYXJyYXksIG4sIGd1YXJkKSB7XG4gICAgcmV0dXJuIHNsaWNlLmNhbGwoYXJyYXksIDAsIE1hdGgubWF4KDAsIGFycmF5Lmxlbmd0aCAtIChuID09IG51bGwgfHwgZ3VhcmQgPyAxIDogbikpKTtcbiAgfTtcblxuICAvLyBHZXQgdGhlIGxhc3QgZWxlbWVudCBvZiBhbiBhcnJheS4gUGFzc2luZyAqKm4qKiB3aWxsIHJldHVybiB0aGUgbGFzdCBOXG4gIC8vIHZhbHVlcyBpbiB0aGUgYXJyYXkuXG4gIF8ubGFzdCA9IGZ1bmN0aW9uKGFycmF5LCBuLCBndWFyZCkge1xuICAgIGlmIChhcnJheSA9PSBudWxsKSByZXR1cm4gdm9pZCAwO1xuICAgIGlmIChuID09IG51bGwgfHwgZ3VhcmQpIHJldHVybiBhcnJheVthcnJheS5sZW5ndGggLSAxXTtcbiAgICByZXR1cm4gXy5yZXN0KGFycmF5LCBNYXRoLm1heCgwLCBhcnJheS5sZW5ndGggLSBuKSk7XG4gIH07XG5cbiAgLy8gUmV0dXJucyBldmVyeXRoaW5nIGJ1dCB0aGUgZmlyc3QgZW50cnkgb2YgdGhlIGFycmF5LiBBbGlhc2VkIGFzIGB0YWlsYCBhbmQgYGRyb3BgLlxuICAvLyBFc3BlY2lhbGx5IHVzZWZ1bCBvbiB0aGUgYXJndW1lbnRzIG9iamVjdC4gUGFzc2luZyBhbiAqKm4qKiB3aWxsIHJldHVyblxuICAvLyB0aGUgcmVzdCBOIHZhbHVlcyBpbiB0aGUgYXJyYXkuXG4gIF8ucmVzdCA9IF8udGFpbCA9IF8uZHJvcCA9IGZ1bmN0aW9uKGFycmF5LCBuLCBndWFyZCkge1xuICAgIHJldHVybiBzbGljZS5jYWxsKGFycmF5LCBuID09IG51bGwgfHwgZ3VhcmQgPyAxIDogbik7XG4gIH07XG5cbiAgLy8gVHJpbSBvdXQgYWxsIGZhbHN5IHZhbHVlcyBmcm9tIGFuIGFycmF5LlxuICBfLmNvbXBhY3QgPSBmdW5jdGlvbihhcnJheSkge1xuICAgIHJldHVybiBfLmZpbHRlcihhcnJheSwgXy5pZGVudGl0eSk7XG4gIH07XG5cbiAgLy8gSW50ZXJuYWwgaW1wbGVtZW50YXRpb24gb2YgYSByZWN1cnNpdmUgYGZsYXR0ZW5gIGZ1bmN0aW9uLlxuICB2YXIgZmxhdHRlbiA9IGZ1bmN0aW9uKGlucHV0LCBzaGFsbG93LCBzdHJpY3QsIHN0YXJ0SW5kZXgpIHtcbiAgICB2YXIgb3V0cHV0ID0gW10sIGlkeCA9IDA7XG4gICAgZm9yICh2YXIgaSA9IHN0YXJ0SW5kZXggfHwgMCwgbGVuZ3RoID0gZ2V0TGVuZ3RoKGlucHV0KTsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgdmFsdWUgPSBpbnB1dFtpXTtcbiAgICAgIGlmIChpc0FycmF5TGlrZSh2YWx1ZSkgJiYgKF8uaXNBcnJheSh2YWx1ZSkgfHwgXy5pc0FyZ3VtZW50cyh2YWx1ZSkpKSB7XG4gICAgICAgIC8vZmxhdHRlbiBjdXJyZW50IGxldmVsIG9mIGFycmF5IG9yIGFyZ3VtZW50cyBvYmplY3RcbiAgICAgICAgaWYgKCFzaGFsbG93KSB2YWx1ZSA9IGZsYXR0ZW4odmFsdWUsIHNoYWxsb3csIHN0cmljdCk7XG4gICAgICAgIHZhciBqID0gMCwgbGVuID0gdmFsdWUubGVuZ3RoO1xuICAgICAgICBvdXRwdXQubGVuZ3RoICs9IGxlbjtcbiAgICAgICAgd2hpbGUgKGogPCBsZW4pIHtcbiAgICAgICAgICBvdXRwdXRbaWR4KytdID0gdmFsdWVbaisrXTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICghc3RyaWN0KSB7XG4gICAgICAgIG91dHB1dFtpZHgrK10gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG91dHB1dDtcbiAgfTtcblxuICAvLyBGbGF0dGVuIG91dCBhbiBhcnJheSwgZWl0aGVyIHJlY3Vyc2l2ZWx5IChieSBkZWZhdWx0KSwgb3IganVzdCBvbmUgbGV2ZWwuXG4gIF8uZmxhdHRlbiA9IGZ1bmN0aW9uKGFycmF5LCBzaGFsbG93KSB7XG4gICAgcmV0dXJuIGZsYXR0ZW4oYXJyYXksIHNoYWxsb3csIGZhbHNlKTtcbiAgfTtcblxuICAvLyBSZXR1cm4gYSB2ZXJzaW9uIG9mIHRoZSBhcnJheSB0aGF0IGRvZXMgbm90IGNvbnRhaW4gdGhlIHNwZWNpZmllZCB2YWx1ZShzKS5cbiAgXy53aXRob3V0ID0gZnVuY3Rpb24oYXJyYXkpIHtcbiAgICByZXR1cm4gXy5kaWZmZXJlbmNlKGFycmF5LCBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSkpO1xuICB9O1xuXG4gIC8vIFByb2R1Y2UgYSBkdXBsaWNhdGUtZnJlZSB2ZXJzaW9uIG9mIHRoZSBhcnJheS4gSWYgdGhlIGFycmF5IGhhcyBhbHJlYWR5XG4gIC8vIGJlZW4gc29ydGVkLCB5b3UgaGF2ZSB0aGUgb3B0aW9uIG9mIHVzaW5nIGEgZmFzdGVyIGFsZ29yaXRobS5cbiAgLy8gQWxpYXNlZCBhcyBgdW5pcXVlYC5cbiAgXy51bmlxID0gXy51bmlxdWUgPSBmdW5jdGlvbihhcnJheSwgaXNTb3J0ZWQsIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgaWYgKCFfLmlzQm9vbGVhbihpc1NvcnRlZCkpIHtcbiAgICAgIGNvbnRleHQgPSBpdGVyYXRlZTtcbiAgICAgIGl0ZXJhdGVlID0gaXNTb3J0ZWQ7XG4gICAgICBpc1NvcnRlZCA9IGZhbHNlO1xuICAgIH1cbiAgICBpZiAoaXRlcmF0ZWUgIT0gbnVsbCkgaXRlcmF0ZWUgPSBjYihpdGVyYXRlZSwgY29udGV4dCk7XG4gICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgIHZhciBzZWVuID0gW107XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IGdldExlbmd0aChhcnJheSk7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdmFyIHZhbHVlID0gYXJyYXlbaV0sXG4gICAgICAgICAgY29tcHV0ZWQgPSBpdGVyYXRlZSA/IGl0ZXJhdGVlKHZhbHVlLCBpLCBhcnJheSkgOiB2YWx1ZTtcbiAgICAgIGlmIChpc1NvcnRlZCkge1xuICAgICAgICBpZiAoIWkgfHwgc2VlbiAhPT0gY29tcHV0ZWQpIHJlc3VsdC5wdXNoKHZhbHVlKTtcbiAgICAgICAgc2VlbiA9IGNvbXB1dGVkO1xuICAgICAgfSBlbHNlIGlmIChpdGVyYXRlZSkge1xuICAgICAgICBpZiAoIV8uY29udGFpbnMoc2VlbiwgY29tcHV0ZWQpKSB7XG4gICAgICAgICAgc2Vlbi5wdXNoKGNvbXB1dGVkKTtcbiAgICAgICAgICByZXN1bHQucHVzaCh2YWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoIV8uY29udGFpbnMocmVzdWx0LCB2YWx1ZSkpIHtcbiAgICAgICAgcmVzdWx0LnB1c2godmFsdWUpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIFByb2R1Y2UgYW4gYXJyYXkgdGhhdCBjb250YWlucyB0aGUgdW5pb246IGVhY2ggZGlzdGluY3QgZWxlbWVudCBmcm9tIGFsbCBvZlxuICAvLyB0aGUgcGFzc2VkLWluIGFycmF5cy5cbiAgXy51bmlvbiA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBfLnVuaXEoZmxhdHRlbihhcmd1bWVudHMsIHRydWUsIHRydWUpKTtcbiAgfTtcblxuICAvLyBQcm9kdWNlIGFuIGFycmF5IHRoYXQgY29udGFpbnMgZXZlcnkgaXRlbSBzaGFyZWQgYmV0d2VlbiBhbGwgdGhlXG4gIC8vIHBhc3NlZC1pbiBhcnJheXMuXG4gIF8uaW50ZXJzZWN0aW9uID0gZnVuY3Rpb24oYXJyYXkpIHtcbiAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgdmFyIGFyZ3NMZW5ndGggPSBhcmd1bWVudHMubGVuZ3RoO1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBnZXRMZW5ndGgoYXJyYXkpOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBpdGVtID0gYXJyYXlbaV07XG4gICAgICBpZiAoXy5jb250YWlucyhyZXN1bHQsIGl0ZW0pKSBjb250aW51ZTtcbiAgICAgIGZvciAodmFyIGogPSAxOyBqIDwgYXJnc0xlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICghXy5jb250YWlucyhhcmd1bWVudHNbal0sIGl0ZW0pKSBicmVhaztcbiAgICAgIH1cbiAgICAgIGlmIChqID09PSBhcmdzTGVuZ3RoKSByZXN1bHQucHVzaChpdGVtKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAvLyBUYWtlIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gb25lIGFycmF5IGFuZCBhIG51bWJlciBvZiBvdGhlciBhcnJheXMuXG4gIC8vIE9ubHkgdGhlIGVsZW1lbnRzIHByZXNlbnQgaW4ganVzdCB0aGUgZmlyc3QgYXJyYXkgd2lsbCByZW1haW4uXG4gIF8uZGlmZmVyZW5jZSA9IGZ1bmN0aW9uKGFycmF5KSB7XG4gICAgdmFyIHJlc3QgPSBmbGF0dGVuKGFyZ3VtZW50cywgdHJ1ZSwgdHJ1ZSwgMSk7XG4gICAgcmV0dXJuIF8uZmlsdGVyKGFycmF5LCBmdW5jdGlvbih2YWx1ZSl7XG4gICAgICByZXR1cm4gIV8uY29udGFpbnMocmVzdCwgdmFsdWUpO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIFppcCB0b2dldGhlciBtdWx0aXBsZSBsaXN0cyBpbnRvIGEgc2luZ2xlIGFycmF5IC0tIGVsZW1lbnRzIHRoYXQgc2hhcmVcbiAgLy8gYW4gaW5kZXggZ28gdG9nZXRoZXIuXG4gIF8uemlwID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIF8udW56aXAoYXJndW1lbnRzKTtcbiAgfTtcblxuICAvLyBDb21wbGVtZW50IG9mIF8uemlwLiBVbnppcCBhY2NlcHRzIGFuIGFycmF5IG9mIGFycmF5cyBhbmQgZ3JvdXBzXG4gIC8vIGVhY2ggYXJyYXkncyBlbGVtZW50cyBvbiBzaGFyZWQgaW5kaWNlc1xuICBfLnVuemlwID0gZnVuY3Rpb24oYXJyYXkpIHtcbiAgICB2YXIgbGVuZ3RoID0gYXJyYXkgJiYgXy5tYXgoYXJyYXksIGdldExlbmd0aCkubGVuZ3RoIHx8IDA7XG4gICAgdmFyIHJlc3VsdCA9IEFycmF5KGxlbmd0aCk7XG5cbiAgICBmb3IgKHZhciBpbmRleCA9IDA7IGluZGV4IDwgbGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICByZXN1bHRbaW5kZXhdID0gXy5wbHVjayhhcnJheSwgaW5kZXgpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIENvbnZlcnRzIGxpc3RzIGludG8gb2JqZWN0cy4gUGFzcyBlaXRoZXIgYSBzaW5nbGUgYXJyYXkgb2YgYFtrZXksIHZhbHVlXWBcbiAgLy8gcGFpcnMsIG9yIHR3byBwYXJhbGxlbCBhcnJheXMgb2YgdGhlIHNhbWUgbGVuZ3RoIC0tIG9uZSBvZiBrZXlzLCBhbmQgb25lIG9mXG4gIC8vIHRoZSBjb3JyZXNwb25kaW5nIHZhbHVlcy5cbiAgXy5vYmplY3QgPSBmdW5jdGlvbihsaXN0LCB2YWx1ZXMpIHtcbiAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IGdldExlbmd0aChsaXN0KTsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAodmFsdWVzKSB7XG4gICAgICAgIHJlc3VsdFtsaXN0W2ldXSA9IHZhbHVlc1tpXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdFtsaXN0W2ldWzBdXSA9IGxpc3RbaV1bMV07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgLy8gR2VuZXJhdG9yIGZ1bmN0aW9uIHRvIGNyZWF0ZSB0aGUgZmluZEluZGV4IGFuZCBmaW5kTGFzdEluZGV4IGZ1bmN0aW9uc1xuICBmdW5jdGlvbiBjcmVhdGVQcmVkaWNhdGVJbmRleEZpbmRlcihkaXIpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oYXJyYXksIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgICAgcHJlZGljYXRlID0gY2IocHJlZGljYXRlLCBjb250ZXh0KTtcbiAgICAgIHZhciBsZW5ndGggPSBnZXRMZW5ndGgoYXJyYXkpO1xuICAgICAgdmFyIGluZGV4ID0gZGlyID4gMCA/IDAgOiBsZW5ndGggLSAxO1xuICAgICAgZm9yICg7IGluZGV4ID49IDAgJiYgaW5kZXggPCBsZW5ndGg7IGluZGV4ICs9IGRpcikge1xuICAgICAgICBpZiAocHJlZGljYXRlKGFycmF5W2luZGV4XSwgaW5kZXgsIGFycmF5KSkgcmV0dXJuIGluZGV4O1xuICAgICAgfVxuICAgICAgcmV0dXJuIC0xO1xuICAgIH07XG4gIH1cblxuICAvLyBSZXR1cm5zIHRoZSBmaXJzdCBpbmRleCBvbiBhbiBhcnJheS1saWtlIHRoYXQgcGFzc2VzIGEgcHJlZGljYXRlIHRlc3RcbiAgXy5maW5kSW5kZXggPSBjcmVhdGVQcmVkaWNhdGVJbmRleEZpbmRlcigxKTtcbiAgXy5maW5kTGFzdEluZGV4ID0gY3JlYXRlUHJlZGljYXRlSW5kZXhGaW5kZXIoLTEpO1xuXG4gIC8vIFVzZSBhIGNvbXBhcmF0b3IgZnVuY3Rpb24gdG8gZmlndXJlIG91dCB0aGUgc21hbGxlc3QgaW5kZXggYXQgd2hpY2hcbiAgLy8gYW4gb2JqZWN0IHNob3VsZCBiZSBpbnNlcnRlZCBzbyBhcyB0byBtYWludGFpbiBvcmRlci4gVXNlcyBiaW5hcnkgc2VhcmNoLlxuICBfLnNvcnRlZEluZGV4ID0gZnVuY3Rpb24oYXJyYXksIG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICBpdGVyYXRlZSA9IGNiKGl0ZXJhdGVlLCBjb250ZXh0LCAxKTtcbiAgICB2YXIgdmFsdWUgPSBpdGVyYXRlZShvYmopO1xuICAgIHZhciBsb3cgPSAwLCBoaWdoID0gZ2V0TGVuZ3RoKGFycmF5KTtcbiAgICB3aGlsZSAobG93IDwgaGlnaCkge1xuICAgICAgdmFyIG1pZCA9IE1hdGguZmxvb3IoKGxvdyArIGhpZ2gpIC8gMik7XG4gICAgICBpZiAoaXRlcmF0ZWUoYXJyYXlbbWlkXSkgPCB2YWx1ZSkgbG93ID0gbWlkICsgMTsgZWxzZSBoaWdoID0gbWlkO1xuICAgIH1cbiAgICByZXR1cm4gbG93O1xuICB9O1xuXG4gIC8vIEdlbmVyYXRvciBmdW5jdGlvbiB0byBjcmVhdGUgdGhlIGluZGV4T2YgYW5kIGxhc3RJbmRleE9mIGZ1bmN0aW9uc1xuICBmdW5jdGlvbiBjcmVhdGVJbmRleEZpbmRlcihkaXIsIHByZWRpY2F0ZUZpbmQsIHNvcnRlZEluZGV4KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKGFycmF5LCBpdGVtLCBpZHgpIHtcbiAgICAgIHZhciBpID0gMCwgbGVuZ3RoID0gZ2V0TGVuZ3RoKGFycmF5KTtcbiAgICAgIGlmICh0eXBlb2YgaWR4ID09ICdudW1iZXInKSB7XG4gICAgICAgIGlmIChkaXIgPiAwKSB7XG4gICAgICAgICAgICBpID0gaWR4ID49IDAgPyBpZHggOiBNYXRoLm1heChpZHggKyBsZW5ndGgsIGkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGVuZ3RoID0gaWR4ID49IDAgPyBNYXRoLm1pbihpZHggKyAxLCBsZW5ndGgpIDogaWR4ICsgbGVuZ3RoICsgMTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChzb3J0ZWRJbmRleCAmJiBpZHggJiYgbGVuZ3RoKSB7XG4gICAgICAgIGlkeCA9IHNvcnRlZEluZGV4KGFycmF5LCBpdGVtKTtcbiAgICAgICAgcmV0dXJuIGFycmF5W2lkeF0gPT09IGl0ZW0gPyBpZHggOiAtMTtcbiAgICAgIH1cbiAgICAgIGlmIChpdGVtICE9PSBpdGVtKSB7XG4gICAgICAgIGlkeCA9IHByZWRpY2F0ZUZpbmQoc2xpY2UuY2FsbChhcnJheSwgaSwgbGVuZ3RoKSwgXy5pc05hTik7XG4gICAgICAgIHJldHVybiBpZHggPj0gMCA/IGlkeCArIGkgOiAtMTtcbiAgICAgIH1cbiAgICAgIGZvciAoaWR4ID0gZGlyID4gMCA/IGkgOiBsZW5ndGggLSAxOyBpZHggPj0gMCAmJiBpZHggPCBsZW5ndGg7IGlkeCArPSBkaXIpIHtcbiAgICAgICAgaWYgKGFycmF5W2lkeF0gPT09IGl0ZW0pIHJldHVybiBpZHg7XG4gICAgICB9XG4gICAgICByZXR1cm4gLTE7XG4gICAgfTtcbiAgfVxuXG4gIC8vIFJldHVybiB0aGUgcG9zaXRpb24gb2YgdGhlIGZpcnN0IG9jY3VycmVuY2Ugb2YgYW4gaXRlbSBpbiBhbiBhcnJheSxcbiAgLy8gb3IgLTEgaWYgdGhlIGl0ZW0gaXMgbm90IGluY2x1ZGVkIGluIHRoZSBhcnJheS5cbiAgLy8gSWYgdGhlIGFycmF5IGlzIGxhcmdlIGFuZCBhbHJlYWR5IGluIHNvcnQgb3JkZXIsIHBhc3MgYHRydWVgXG4gIC8vIGZvciAqKmlzU29ydGVkKiogdG8gdXNlIGJpbmFyeSBzZWFyY2guXG4gIF8uaW5kZXhPZiA9IGNyZWF0ZUluZGV4RmluZGVyKDEsIF8uZmluZEluZGV4LCBfLnNvcnRlZEluZGV4KTtcbiAgXy5sYXN0SW5kZXhPZiA9IGNyZWF0ZUluZGV4RmluZGVyKC0xLCBfLmZpbmRMYXN0SW5kZXgpO1xuXG4gIC8vIEdlbmVyYXRlIGFuIGludGVnZXIgQXJyYXkgY29udGFpbmluZyBhbiBhcml0aG1ldGljIHByb2dyZXNzaW9uLiBBIHBvcnQgb2ZcbiAgLy8gdGhlIG5hdGl2ZSBQeXRob24gYHJhbmdlKClgIGZ1bmN0aW9uLiBTZWVcbiAgLy8gW3RoZSBQeXRob24gZG9jdW1lbnRhdGlvbl0oaHR0cDovL2RvY3MucHl0aG9uLm9yZy9saWJyYXJ5L2Z1bmN0aW9ucy5odG1sI3JhbmdlKS5cbiAgXy5yYW5nZSA9IGZ1bmN0aW9uKHN0YXJ0LCBzdG9wLCBzdGVwKSB7XG4gICAgaWYgKHN0b3AgPT0gbnVsbCkge1xuICAgICAgc3RvcCA9IHN0YXJ0IHx8IDA7XG4gICAgICBzdGFydCA9IDA7XG4gICAgfVxuICAgIHN0ZXAgPSBzdGVwIHx8IDE7XG5cbiAgICB2YXIgbGVuZ3RoID0gTWF0aC5tYXgoTWF0aC5jZWlsKChzdG9wIC0gc3RhcnQpIC8gc3RlcCksIDApO1xuICAgIHZhciByYW5nZSA9IEFycmF5KGxlbmd0aCk7XG5cbiAgICBmb3IgKHZhciBpZHggPSAwOyBpZHggPCBsZW5ndGg7IGlkeCsrLCBzdGFydCArPSBzdGVwKSB7XG4gICAgICByYW5nZVtpZHhdID0gc3RhcnQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJhbmdlO1xuICB9O1xuXG4gIC8vIEZ1bmN0aW9uIChhaGVtKSBGdW5jdGlvbnNcbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gRGV0ZXJtaW5lcyB3aGV0aGVyIHRvIGV4ZWN1dGUgYSBmdW5jdGlvbiBhcyBhIGNvbnN0cnVjdG9yXG4gIC8vIG9yIGEgbm9ybWFsIGZ1bmN0aW9uIHdpdGggdGhlIHByb3ZpZGVkIGFyZ3VtZW50c1xuICB2YXIgZXhlY3V0ZUJvdW5kID0gZnVuY3Rpb24oc291cmNlRnVuYywgYm91bmRGdW5jLCBjb250ZXh0LCBjYWxsaW5nQ29udGV4dCwgYXJncykge1xuICAgIGlmICghKGNhbGxpbmdDb250ZXh0IGluc3RhbmNlb2YgYm91bmRGdW5jKSkgcmV0dXJuIHNvdXJjZUZ1bmMuYXBwbHkoY29udGV4dCwgYXJncyk7XG4gICAgdmFyIHNlbGYgPSBiYXNlQ3JlYXRlKHNvdXJjZUZ1bmMucHJvdG90eXBlKTtcbiAgICB2YXIgcmVzdWx0ID0gc291cmNlRnVuYy5hcHBseShzZWxmLCBhcmdzKTtcbiAgICBpZiAoXy5pc09iamVjdChyZXN1bHQpKSByZXR1cm4gcmVzdWx0O1xuICAgIHJldHVybiBzZWxmO1xuICB9O1xuXG4gIC8vIENyZWF0ZSBhIGZ1bmN0aW9uIGJvdW5kIHRvIGEgZ2l2ZW4gb2JqZWN0IChhc3NpZ25pbmcgYHRoaXNgLCBhbmQgYXJndW1lbnRzLFxuICAvLyBvcHRpb25hbGx5KS4gRGVsZWdhdGVzIHRvICoqRUNNQVNjcmlwdCA1KioncyBuYXRpdmUgYEZ1bmN0aW9uLmJpbmRgIGlmXG4gIC8vIGF2YWlsYWJsZS5cbiAgXy5iaW5kID0gZnVuY3Rpb24oZnVuYywgY29udGV4dCkge1xuICAgIGlmIChuYXRpdmVCaW5kICYmIGZ1bmMuYmluZCA9PT0gbmF0aXZlQmluZCkgcmV0dXJuIG5hdGl2ZUJpbmQuYXBwbHkoZnVuYywgc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpKTtcbiAgICBpZiAoIV8uaXNGdW5jdGlvbihmdW5jKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQmluZCBtdXN0IGJlIGNhbGxlZCBvbiBhIGZ1bmN0aW9uJyk7XG4gICAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gICAgdmFyIGJvdW5kID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gZXhlY3V0ZUJvdW5kKGZ1bmMsIGJvdW5kLCBjb250ZXh0LCB0aGlzLCBhcmdzLmNvbmNhdChzbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICB9O1xuICAgIHJldHVybiBib3VuZDtcbiAgfTtcblxuICAvLyBQYXJ0aWFsbHkgYXBwbHkgYSBmdW5jdGlvbiBieSBjcmVhdGluZyBhIHZlcnNpb24gdGhhdCBoYXMgaGFkIHNvbWUgb2YgaXRzXG4gIC8vIGFyZ3VtZW50cyBwcmUtZmlsbGVkLCB3aXRob3V0IGNoYW5naW5nIGl0cyBkeW5hbWljIGB0aGlzYCBjb250ZXh0LiBfIGFjdHNcbiAgLy8gYXMgYSBwbGFjZWhvbGRlciwgYWxsb3dpbmcgYW55IGNvbWJpbmF0aW9uIG9mIGFyZ3VtZW50cyB0byBiZSBwcmUtZmlsbGVkLlxuICBfLnBhcnRpYWwgPSBmdW5jdGlvbihmdW5jKSB7XG4gICAgdmFyIGJvdW5kQXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICB2YXIgYm91bmQgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwb3NpdGlvbiA9IDAsIGxlbmd0aCA9IGJvdW5kQXJncy5sZW5ndGg7XG4gICAgICB2YXIgYXJncyA9IEFycmF5KGxlbmd0aCk7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFyZ3NbaV0gPSBib3VuZEFyZ3NbaV0gPT09IF8gPyBhcmd1bWVudHNbcG9zaXRpb24rK10gOiBib3VuZEFyZ3NbaV07XG4gICAgICB9XG4gICAgICB3aGlsZSAocG9zaXRpb24gPCBhcmd1bWVudHMubGVuZ3RoKSBhcmdzLnB1c2goYXJndW1lbnRzW3Bvc2l0aW9uKytdKTtcbiAgICAgIHJldHVybiBleGVjdXRlQm91bmQoZnVuYywgYm91bmQsIHRoaXMsIHRoaXMsIGFyZ3MpO1xuICAgIH07XG4gICAgcmV0dXJuIGJvdW5kO1xuICB9O1xuXG4gIC8vIEJpbmQgYSBudW1iZXIgb2YgYW4gb2JqZWN0J3MgbWV0aG9kcyB0byB0aGF0IG9iamVjdC4gUmVtYWluaW5nIGFyZ3VtZW50c1xuICAvLyBhcmUgdGhlIG1ldGhvZCBuYW1lcyB0byBiZSBib3VuZC4gVXNlZnVsIGZvciBlbnN1cmluZyB0aGF0IGFsbCBjYWxsYmFja3NcbiAgLy8gZGVmaW5lZCBvbiBhbiBvYmplY3QgYmVsb25nIHRvIGl0LlxuICBfLmJpbmRBbGwgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgaSwgbGVuZ3RoID0gYXJndW1lbnRzLmxlbmd0aCwga2V5O1xuICAgIGlmIChsZW5ndGggPD0gMSkgdGhyb3cgbmV3IEVycm9yKCdiaW5kQWxsIG11c3QgYmUgcGFzc2VkIGZ1bmN0aW9uIG5hbWVzJyk7XG4gICAgZm9yIChpID0gMTsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBrZXkgPSBhcmd1bWVudHNbaV07XG4gICAgICBvYmpba2V5XSA9IF8uYmluZChvYmpba2V5XSwgb2JqKTtcbiAgICB9XG4gICAgcmV0dXJuIG9iajtcbiAgfTtcblxuICAvLyBNZW1vaXplIGFuIGV4cGVuc2l2ZSBmdW5jdGlvbiBieSBzdG9yaW5nIGl0cyByZXN1bHRzLlxuICBfLm1lbW9pemUgPSBmdW5jdGlvbihmdW5jLCBoYXNoZXIpIHtcbiAgICB2YXIgbWVtb2l6ZSA9IGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyIGNhY2hlID0gbWVtb2l6ZS5jYWNoZTtcbiAgICAgIHZhciBhZGRyZXNzID0gJycgKyAoaGFzaGVyID8gaGFzaGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBrZXkpO1xuICAgICAgaWYgKCFfLmhhcyhjYWNoZSwgYWRkcmVzcykpIGNhY2hlW2FkZHJlc3NdID0gZnVuYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgcmV0dXJuIGNhY2hlW2FkZHJlc3NdO1xuICAgIH07XG4gICAgbWVtb2l6ZS5jYWNoZSA9IHt9O1xuICAgIHJldHVybiBtZW1vaXplO1xuICB9O1xuXG4gIC8vIERlbGF5cyBhIGZ1bmN0aW9uIGZvciB0aGUgZ2l2ZW4gbnVtYmVyIG9mIG1pbGxpc2Vjb25kcywgYW5kIHRoZW4gY2FsbHNcbiAgLy8gaXQgd2l0aCB0aGUgYXJndW1lbnRzIHN1cHBsaWVkLlxuICBfLmRlbGF5ID0gZnVuY3Rpb24oZnVuYywgd2FpdCkge1xuICAgIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpO1xuICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1bmN0aW9uKCl7XG4gICAgICByZXR1cm4gZnVuYy5hcHBseShudWxsLCBhcmdzKTtcbiAgICB9LCB3YWl0KTtcbiAgfTtcblxuICAvLyBEZWZlcnMgYSBmdW5jdGlvbiwgc2NoZWR1bGluZyBpdCB0byBydW4gYWZ0ZXIgdGhlIGN1cnJlbnQgY2FsbCBzdGFjayBoYXNcbiAgLy8gY2xlYXJlZC5cbiAgXy5kZWZlciA9IF8ucGFydGlhbChfLmRlbGF5LCBfLCAxKTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24sIHRoYXQsIHdoZW4gaW52b2tlZCwgd2lsbCBvbmx5IGJlIHRyaWdnZXJlZCBhdCBtb3N0IG9uY2VcbiAgLy8gZHVyaW5nIGEgZ2l2ZW4gd2luZG93IG9mIHRpbWUuIE5vcm1hbGx5LCB0aGUgdGhyb3R0bGVkIGZ1bmN0aW9uIHdpbGwgcnVuXG4gIC8vIGFzIG11Y2ggYXMgaXQgY2FuLCB3aXRob3V0IGV2ZXIgZ29pbmcgbW9yZSB0aGFuIG9uY2UgcGVyIGB3YWl0YCBkdXJhdGlvbjtcbiAgLy8gYnV0IGlmIHlvdSdkIGxpa2UgdG8gZGlzYWJsZSB0aGUgZXhlY3V0aW9uIG9uIHRoZSBsZWFkaW5nIGVkZ2UsIHBhc3NcbiAgLy8gYHtsZWFkaW5nOiBmYWxzZX1gLiBUbyBkaXNhYmxlIGV4ZWN1dGlvbiBvbiB0aGUgdHJhaWxpbmcgZWRnZSwgZGl0dG8uXG4gIF8udGhyb3R0bGUgPSBmdW5jdGlvbihmdW5jLCB3YWl0LCBvcHRpb25zKSB7XG4gICAgdmFyIGNvbnRleHQsIGFyZ3MsIHJlc3VsdDtcbiAgICB2YXIgdGltZW91dCA9IG51bGw7XG4gICAgdmFyIHByZXZpb3VzID0gMDtcbiAgICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcbiAgICB2YXIgbGF0ZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIHByZXZpb3VzID0gb3B0aW9ucy5sZWFkaW5nID09PSBmYWxzZSA/IDAgOiBfLm5vdygpO1xuICAgICAgdGltZW91dCA9IG51bGw7XG4gICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgaWYgKCF0aW1lb3V0KSBjb250ZXh0ID0gYXJncyA9IG51bGw7XG4gICAgfTtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgbm93ID0gXy5ub3coKTtcbiAgICAgIGlmICghcHJldmlvdXMgJiYgb3B0aW9ucy5sZWFkaW5nID09PSBmYWxzZSkgcHJldmlvdXMgPSBub3c7XG4gICAgICB2YXIgcmVtYWluaW5nID0gd2FpdCAtIChub3cgLSBwcmV2aW91cyk7XG4gICAgICBjb250ZXh0ID0gdGhpcztcbiAgICAgIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICBpZiAocmVtYWluaW5nIDw9IDAgfHwgcmVtYWluaW5nID4gd2FpdCkge1xuICAgICAgICBpZiAodGltZW91dCkge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBwcmV2aW91cyA9IG5vdztcbiAgICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgICAgaWYgKCF0aW1lb3V0KSBjb250ZXh0ID0gYXJncyA9IG51bGw7XG4gICAgICB9IGVsc2UgaWYgKCF0aW1lb3V0ICYmIG9wdGlvbnMudHJhaWxpbmcgIT09IGZhbHNlKSB7XG4gICAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGxhdGVyLCByZW1haW5pbmcpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9O1xuXG4gIC8vIFJldHVybnMgYSBmdW5jdGlvbiwgdGhhdCwgYXMgbG9uZyBhcyBpdCBjb250aW51ZXMgdG8gYmUgaW52b2tlZCwgd2lsbCBub3RcbiAgLy8gYmUgdHJpZ2dlcmVkLiBUaGUgZnVuY3Rpb24gd2lsbCBiZSBjYWxsZWQgYWZ0ZXIgaXQgc3RvcHMgYmVpbmcgY2FsbGVkIGZvclxuICAvLyBOIG1pbGxpc2Vjb25kcy4gSWYgYGltbWVkaWF0ZWAgaXMgcGFzc2VkLCB0cmlnZ2VyIHRoZSBmdW5jdGlvbiBvbiB0aGVcbiAgLy8gbGVhZGluZyBlZGdlLCBpbnN0ZWFkIG9mIHRoZSB0cmFpbGluZy5cbiAgXy5kZWJvdW5jZSA9IGZ1bmN0aW9uKGZ1bmMsIHdhaXQsIGltbWVkaWF0ZSkge1xuICAgIHZhciB0aW1lb3V0LCBhcmdzLCBjb250ZXh0LCB0aW1lc3RhbXAsIHJlc3VsdDtcblxuICAgIHZhciBsYXRlciA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGxhc3QgPSBfLm5vdygpIC0gdGltZXN0YW1wO1xuXG4gICAgICBpZiAobGFzdCA8IHdhaXQgJiYgbGFzdCA+PSAwKSB7XG4gICAgICAgIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGxhdGVyLCB3YWl0IC0gbGFzdCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aW1lb3V0ID0gbnVsbDtcbiAgICAgICAgaWYgKCFpbW1lZGlhdGUpIHtcbiAgICAgICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KGNvbnRleHQsIGFyZ3MpO1xuICAgICAgICAgIGlmICghdGltZW91dCkgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgIGNvbnRleHQgPSB0aGlzO1xuICAgICAgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIHRpbWVzdGFtcCA9IF8ubm93KCk7XG4gICAgICB2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcbiAgICAgIGlmICghdGltZW91dCkgdGltZW91dCA9IHNldFRpbWVvdXQobGF0ZXIsIHdhaXQpO1xuICAgICAgaWYgKGNhbGxOb3cpIHtcbiAgICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseShjb250ZXh0LCBhcmdzKTtcbiAgICAgICAgY29udGV4dCA9IGFyZ3MgPSBudWxsO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyB0aGUgZmlyc3QgZnVuY3Rpb24gcGFzc2VkIGFzIGFuIGFyZ3VtZW50IHRvIHRoZSBzZWNvbmQsXG4gIC8vIGFsbG93aW5nIHlvdSB0byBhZGp1c3QgYXJndW1lbnRzLCBydW4gY29kZSBiZWZvcmUgYW5kIGFmdGVyLCBhbmRcbiAgLy8gY29uZGl0aW9uYWxseSBleGVjdXRlIHRoZSBvcmlnaW5hbCBmdW5jdGlvbi5cbiAgXy53cmFwID0gZnVuY3Rpb24oZnVuYywgd3JhcHBlcikge1xuICAgIHJldHVybiBfLnBhcnRpYWwod3JhcHBlciwgZnVuYyk7XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIG5lZ2F0ZWQgdmVyc2lvbiBvZiB0aGUgcGFzc2VkLWluIHByZWRpY2F0ZS5cbiAgXy5uZWdhdGUgPSBmdW5jdGlvbihwcmVkaWNhdGUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gIXByZWRpY2F0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH07XG5cbiAgLy8gUmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgaXMgdGhlIGNvbXBvc2l0aW9uIG9mIGEgbGlzdCBvZiBmdW5jdGlvbnMsIGVhY2hcbiAgLy8gY29uc3VtaW5nIHRoZSByZXR1cm4gdmFsdWUgb2YgdGhlIGZ1bmN0aW9uIHRoYXQgZm9sbG93cy5cbiAgXy5jb21wb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgdmFyIHN0YXJ0ID0gYXJncy5sZW5ndGggLSAxO1xuICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBpID0gc3RhcnQ7XG4gICAgICB2YXIgcmVzdWx0ID0gYXJnc1tzdGFydF0uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIHdoaWxlIChpLS0pIHJlc3VsdCA9IGFyZ3NbaV0uY2FsbCh0aGlzLCByZXN1bHQpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9O1xuXG4gIC8vIFJldHVybnMgYSBmdW5jdGlvbiB0aGF0IHdpbGwgb25seSBiZSBleGVjdXRlZCBvbiBhbmQgYWZ0ZXIgdGhlIE50aCBjYWxsLlxuICBfLmFmdGVyID0gZnVuY3Rpb24odGltZXMsIGZ1bmMpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoLS10aW1lcyA8IDEpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIC8vIFJldHVybnMgYSBmdW5jdGlvbiB0aGF0IHdpbGwgb25seSBiZSBleGVjdXRlZCB1cCB0byAoYnV0IG5vdCBpbmNsdWRpbmcpIHRoZSBOdGggY2FsbC5cbiAgXy5iZWZvcmUgPSBmdW5jdGlvbih0aW1lcywgZnVuYykge1xuICAgIHZhciBtZW1vO1xuICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgtLXRpbWVzID4gMCkge1xuICAgICAgICBtZW1vID0gZnVuYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgfVxuICAgICAgaWYgKHRpbWVzIDw9IDEpIGZ1bmMgPSBudWxsO1xuICAgICAgcmV0dXJuIG1lbW87XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgZnVuY3Rpb24gdGhhdCB3aWxsIGJlIGV4ZWN1dGVkIGF0IG1vc3Qgb25lIHRpbWUsIG5vIG1hdHRlciBob3dcbiAgLy8gb2Z0ZW4geW91IGNhbGwgaXQuIFVzZWZ1bCBmb3IgbGF6eSBpbml0aWFsaXphdGlvbi5cbiAgXy5vbmNlID0gXy5wYXJ0aWFsKF8uYmVmb3JlLCAyKTtcblxuICAvLyBPYmplY3QgRnVuY3Rpb25zXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS1cblxuICAvLyBLZXlzIGluIElFIDwgOSB0aGF0IHdvbid0IGJlIGl0ZXJhdGVkIGJ5IGBmb3Iga2V5IGluIC4uLmAgYW5kIHRodXMgbWlzc2VkLlxuICB2YXIgaGFzRW51bUJ1ZyA9ICF7dG9TdHJpbmc6IG51bGx9LnByb3BlcnR5SXNFbnVtZXJhYmxlKCd0b1N0cmluZycpO1xuICB2YXIgbm9uRW51bWVyYWJsZVByb3BzID0gWyd2YWx1ZU9mJywgJ2lzUHJvdG90eXBlT2YnLCAndG9TdHJpbmcnLFxuICAgICAgICAgICAgICAgICAgICAgICdwcm9wZXJ0eUlzRW51bWVyYWJsZScsICdoYXNPd25Qcm9wZXJ0eScsICd0b0xvY2FsZVN0cmluZyddO1xuXG4gIGZ1bmN0aW9uIGNvbGxlY3ROb25FbnVtUHJvcHMob2JqLCBrZXlzKSB7XG4gICAgdmFyIG5vbkVudW1JZHggPSBub25FbnVtZXJhYmxlUHJvcHMubGVuZ3RoO1xuICAgIHZhciBjb25zdHJ1Y3RvciA9IG9iai5jb25zdHJ1Y3RvcjtcbiAgICB2YXIgcHJvdG8gPSAoXy5pc0Z1bmN0aW9uKGNvbnN0cnVjdG9yKSAmJiBjb25zdHJ1Y3Rvci5wcm90b3R5cGUpIHx8IE9ialByb3RvO1xuXG4gICAgLy8gQ29uc3RydWN0b3IgaXMgYSBzcGVjaWFsIGNhc2UuXG4gICAgdmFyIHByb3AgPSAnY29uc3RydWN0b3InO1xuICAgIGlmIChfLmhhcyhvYmosIHByb3ApICYmICFfLmNvbnRhaW5zKGtleXMsIHByb3ApKSBrZXlzLnB1c2gocHJvcCk7XG5cbiAgICB3aGlsZSAobm9uRW51bUlkeC0tKSB7XG4gICAgICBwcm9wID0gbm9uRW51bWVyYWJsZVByb3BzW25vbkVudW1JZHhdO1xuICAgICAgaWYgKHByb3AgaW4gb2JqICYmIG9ialtwcm9wXSAhPT0gcHJvdG9bcHJvcF0gJiYgIV8uY29udGFpbnMoa2V5cywgcHJvcCkpIHtcbiAgICAgICAga2V5cy5wdXNoKHByb3ApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFJldHJpZXZlIHRoZSBuYW1lcyBvZiBhbiBvYmplY3QncyBvd24gcHJvcGVydGllcy5cbiAgLy8gRGVsZWdhdGVzIHRvICoqRUNNQVNjcmlwdCA1KioncyBuYXRpdmUgYE9iamVjdC5rZXlzYFxuICBfLmtleXMgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAoIV8uaXNPYmplY3Qob2JqKSkgcmV0dXJuIFtdO1xuICAgIGlmIChuYXRpdmVLZXlzKSByZXR1cm4gbmF0aXZlS2V5cyhvYmopO1xuICAgIHZhciBrZXlzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikgaWYgKF8uaGFzKG9iaiwga2V5KSkga2V5cy5wdXNoKGtleSk7XG4gICAgLy8gQWhlbSwgSUUgPCA5LlxuICAgIGlmIChoYXNFbnVtQnVnKSBjb2xsZWN0Tm9uRW51bVByb3BzKG9iaiwga2V5cyk7XG4gICAgcmV0dXJuIGtleXM7XG4gIH07XG5cbiAgLy8gUmV0cmlldmUgYWxsIHRoZSBwcm9wZXJ0eSBuYW1lcyBvZiBhbiBvYmplY3QuXG4gIF8uYWxsS2V5cyA9IGZ1bmN0aW9uKG9iaikge1xuICAgIGlmICghXy5pc09iamVjdChvYmopKSByZXR1cm4gW107XG4gICAgdmFyIGtleXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSBrZXlzLnB1c2goa2V5KTtcbiAgICAvLyBBaGVtLCBJRSA8IDkuXG4gICAgaWYgKGhhc0VudW1CdWcpIGNvbGxlY3ROb25FbnVtUHJvcHMob2JqLCBrZXlzKTtcbiAgICByZXR1cm4ga2V5cztcbiAgfTtcblxuICAvLyBSZXRyaWV2ZSB0aGUgdmFsdWVzIG9mIGFuIG9iamVjdCdzIHByb3BlcnRpZXMuXG4gIF8udmFsdWVzID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgdmFyIGtleXMgPSBfLmtleXMob2JqKTtcbiAgICB2YXIgbGVuZ3RoID0ga2V5cy5sZW5ndGg7XG4gICAgdmFyIHZhbHVlcyA9IEFycmF5KGxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdmFsdWVzW2ldID0gb2JqW2tleXNbaV1dO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWVzO1xuICB9O1xuXG4gIC8vIFJldHVybnMgdGhlIHJlc3VsdHMgb2YgYXBwbHlpbmcgdGhlIGl0ZXJhdGVlIHRvIGVhY2ggZWxlbWVudCBvZiB0aGUgb2JqZWN0XG4gIC8vIEluIGNvbnRyYXN0IHRvIF8ubWFwIGl0IHJldHVybnMgYW4gb2JqZWN0XG4gIF8ubWFwT2JqZWN0ID0gZnVuY3Rpb24ob2JqLCBpdGVyYXRlZSwgY29udGV4dCkge1xuICAgIGl0ZXJhdGVlID0gY2IoaXRlcmF0ZWUsIGNvbnRleHQpO1xuICAgIHZhciBrZXlzID0gIF8ua2V5cyhvYmopLFxuICAgICAgICAgIGxlbmd0aCA9IGtleXMubGVuZ3RoLFxuICAgICAgICAgIHJlc3VsdHMgPSB7fSxcbiAgICAgICAgICBjdXJyZW50S2V5O1xuICAgICAgZm9yICh2YXIgaW5kZXggPSAwOyBpbmRleCA8IGxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICBjdXJyZW50S2V5ID0ga2V5c1tpbmRleF07XG4gICAgICAgIHJlc3VsdHNbY3VycmVudEtleV0gPSBpdGVyYXRlZShvYmpbY3VycmVudEtleV0sIGN1cnJlbnRLZXksIG9iaik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgfTtcblxuICAvLyBDb252ZXJ0IGFuIG9iamVjdCBpbnRvIGEgbGlzdCBvZiBgW2tleSwgdmFsdWVdYCBwYWlycy5cbiAgXy5wYWlycyA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHZhciBrZXlzID0gXy5rZXlzKG9iaik7XG4gICAgdmFyIGxlbmd0aCA9IGtleXMubGVuZ3RoO1xuICAgIHZhciBwYWlycyA9IEFycmF5KGxlbmd0aCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgcGFpcnNbaV0gPSBba2V5c1tpXSwgb2JqW2tleXNbaV1dXTtcbiAgICB9XG4gICAgcmV0dXJuIHBhaXJzO1xuICB9O1xuXG4gIC8vIEludmVydCB0aGUga2V5cyBhbmQgdmFsdWVzIG9mIGFuIG9iamVjdC4gVGhlIHZhbHVlcyBtdXN0IGJlIHNlcmlhbGl6YWJsZS5cbiAgXy5pbnZlcnQgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgcmVzdWx0ID0ge307XG4gICAgdmFyIGtleXMgPSBfLmtleXMob2JqKTtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuZ3RoID0ga2V5cy5sZW5ndGg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgcmVzdWx0W29ialtrZXlzW2ldXV0gPSBrZXlzW2ldO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIFJldHVybiBhIHNvcnRlZCBsaXN0IG9mIHRoZSBmdW5jdGlvbiBuYW1lcyBhdmFpbGFibGUgb24gdGhlIG9iamVjdC5cbiAgLy8gQWxpYXNlZCBhcyBgbWV0aG9kc2BcbiAgXy5mdW5jdGlvbnMgPSBfLm1ldGhvZHMgPSBmdW5jdGlvbihvYmopIHtcbiAgICB2YXIgbmFtZXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICBpZiAoXy5pc0Z1bmN0aW9uKG9ialtrZXldKSkgbmFtZXMucHVzaChrZXkpO1xuICAgIH1cbiAgICByZXR1cm4gbmFtZXMuc29ydCgpO1xuICB9O1xuXG4gIC8vIEV4dGVuZCBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgcHJvcGVydGllcyBpbiBwYXNzZWQtaW4gb2JqZWN0KHMpLlxuICBfLmV4dGVuZCA9IGNyZWF0ZUFzc2lnbmVyKF8uYWxsS2V5cyk7XG5cbiAgLy8gQXNzaWducyBhIGdpdmVuIG9iamVjdCB3aXRoIGFsbCB0aGUgb3duIHByb3BlcnRpZXMgaW4gdGhlIHBhc3NlZC1pbiBvYmplY3QocylcbiAgLy8gKGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL09iamVjdC9hc3NpZ24pXG4gIF8uZXh0ZW5kT3duID0gXy5hc3NpZ24gPSBjcmVhdGVBc3NpZ25lcihfLmtleXMpO1xuXG4gIC8vIFJldHVybnMgdGhlIGZpcnN0IGtleSBvbiBhbiBvYmplY3QgdGhhdCBwYXNzZXMgYSBwcmVkaWNhdGUgdGVzdFxuICBfLmZpbmRLZXkgPSBmdW5jdGlvbihvYmosIHByZWRpY2F0ZSwgY29udGV4dCkge1xuICAgIHByZWRpY2F0ZSA9IGNiKHByZWRpY2F0ZSwgY29udGV4dCk7XG4gICAgdmFyIGtleXMgPSBfLmtleXMob2JqKSwga2V5O1xuICAgIGZvciAodmFyIGkgPSAwLCBsZW5ndGggPSBrZXlzLmxlbmd0aDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBrZXkgPSBrZXlzW2ldO1xuICAgICAgaWYgKHByZWRpY2F0ZShvYmpba2V5XSwga2V5LCBvYmopKSByZXR1cm4ga2V5O1xuICAgIH1cbiAgfTtcblxuICAvLyBSZXR1cm4gYSBjb3B5IG9mIHRoZSBvYmplY3Qgb25seSBjb250YWluaW5nIHRoZSB3aGl0ZWxpc3RlZCBwcm9wZXJ0aWVzLlxuICBfLnBpY2sgPSBmdW5jdGlvbihvYmplY3QsIG9pdGVyYXRlZSwgY29udGV4dCkge1xuICAgIHZhciByZXN1bHQgPSB7fSwgb2JqID0gb2JqZWN0LCBpdGVyYXRlZSwga2V5cztcbiAgICBpZiAob2JqID09IG51bGwpIHJldHVybiByZXN1bHQ7XG4gICAgaWYgKF8uaXNGdW5jdGlvbihvaXRlcmF0ZWUpKSB7XG4gICAgICBrZXlzID0gXy5hbGxLZXlzKG9iaik7XG4gICAgICBpdGVyYXRlZSA9IG9wdGltaXplQ2Iob2l0ZXJhdGVlLCBjb250ZXh0KTtcbiAgICB9IGVsc2Uge1xuICAgICAga2V5cyA9IGZsYXR0ZW4oYXJndW1lbnRzLCBmYWxzZSwgZmFsc2UsIDEpO1xuICAgICAgaXRlcmF0ZWUgPSBmdW5jdGlvbih2YWx1ZSwga2V5LCBvYmopIHsgcmV0dXJuIGtleSBpbiBvYmo7IH07XG4gICAgICBvYmogPSBPYmplY3Qob2JqKTtcbiAgICB9XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbmd0aCA9IGtleXMubGVuZ3RoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBrZXkgPSBrZXlzW2ldO1xuICAgICAgdmFyIHZhbHVlID0gb2JqW2tleV07XG4gICAgICBpZiAoaXRlcmF0ZWUodmFsdWUsIGtleSwgb2JqKSkgcmVzdWx0W2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICAgLy8gUmV0dXJuIGEgY29weSBvZiB0aGUgb2JqZWN0IHdpdGhvdXQgdGhlIGJsYWNrbGlzdGVkIHByb3BlcnRpZXMuXG4gIF8ub21pdCA9IGZ1bmN0aW9uKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpIHtcbiAgICBpZiAoXy5pc0Z1bmN0aW9uKGl0ZXJhdGVlKSkge1xuICAgICAgaXRlcmF0ZWUgPSBfLm5lZ2F0ZShpdGVyYXRlZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBrZXlzID0gXy5tYXAoZmxhdHRlbihhcmd1bWVudHMsIGZhbHNlLCBmYWxzZSwgMSksIFN0cmluZyk7XG4gICAgICBpdGVyYXRlZSA9IGZ1bmN0aW9uKHZhbHVlLCBrZXkpIHtcbiAgICAgICAgcmV0dXJuICFfLmNvbnRhaW5zKGtleXMsIGtleSk7XG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gXy5waWNrKG9iaiwgaXRlcmF0ZWUsIGNvbnRleHQpO1xuICB9O1xuXG4gIC8vIEZpbGwgaW4gYSBnaXZlbiBvYmplY3Qgd2l0aCBkZWZhdWx0IHByb3BlcnRpZXMuXG4gIF8uZGVmYXVsdHMgPSBjcmVhdGVBc3NpZ25lcihfLmFsbEtleXMsIHRydWUpO1xuXG4gIC8vIENyZWF0ZXMgYW4gb2JqZWN0IHRoYXQgaW5oZXJpdHMgZnJvbSB0aGUgZ2l2ZW4gcHJvdG90eXBlIG9iamVjdC5cbiAgLy8gSWYgYWRkaXRpb25hbCBwcm9wZXJ0aWVzIGFyZSBwcm92aWRlZCB0aGVuIHRoZXkgd2lsbCBiZSBhZGRlZCB0byB0aGVcbiAgLy8gY3JlYXRlZCBvYmplY3QuXG4gIF8uY3JlYXRlID0gZnVuY3Rpb24ocHJvdG90eXBlLCBwcm9wcykge1xuICAgIHZhciByZXN1bHQgPSBiYXNlQ3JlYXRlKHByb3RvdHlwZSk7XG4gICAgaWYgKHByb3BzKSBfLmV4dGVuZE93bihyZXN1bHQsIHByb3BzKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIC8vIENyZWF0ZSBhIChzaGFsbG93LWNsb25lZCkgZHVwbGljYXRlIG9mIGFuIG9iamVjdC5cbiAgXy5jbG9uZSA9IGZ1bmN0aW9uKG9iaikge1xuICAgIGlmICghXy5pc09iamVjdChvYmopKSByZXR1cm4gb2JqO1xuICAgIHJldHVybiBfLmlzQXJyYXkob2JqKSA/IG9iai5zbGljZSgpIDogXy5leHRlbmQoe30sIG9iaik7XG4gIH07XG5cbiAgLy8gSW52b2tlcyBpbnRlcmNlcHRvciB3aXRoIHRoZSBvYmosIGFuZCB0aGVuIHJldHVybnMgb2JqLlxuICAvLyBUaGUgcHJpbWFyeSBwdXJwb3NlIG9mIHRoaXMgbWV0aG9kIGlzIHRvIFwidGFwIGludG9cIiBhIG1ldGhvZCBjaGFpbiwgaW5cbiAgLy8gb3JkZXIgdG8gcGVyZm9ybSBvcGVyYXRpb25zIG9uIGludGVybWVkaWF0ZSByZXN1bHRzIHdpdGhpbiB0aGUgY2hhaW4uXG4gIF8udGFwID0gZnVuY3Rpb24ob2JqLCBpbnRlcmNlcHRvcikge1xuICAgIGludGVyY2VwdG9yKG9iaik7XG4gICAgcmV0dXJuIG9iajtcbiAgfTtcblxuICAvLyBSZXR1cm5zIHdoZXRoZXIgYW4gb2JqZWN0IGhhcyBhIGdpdmVuIHNldCBvZiBga2V5OnZhbHVlYCBwYWlycy5cbiAgXy5pc01hdGNoID0gZnVuY3Rpb24ob2JqZWN0LCBhdHRycykge1xuICAgIHZhciBrZXlzID0gXy5rZXlzKGF0dHJzKSwgbGVuZ3RoID0ga2V5cy5sZW5ndGg7XG4gICAgaWYgKG9iamVjdCA9PSBudWxsKSByZXR1cm4gIWxlbmd0aDtcbiAgICB2YXIgb2JqID0gT2JqZWN0KG9iamVjdCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGtleSA9IGtleXNbaV07XG4gICAgICBpZiAoYXR0cnNba2V5XSAhPT0gb2JqW2tleV0gfHwgIShrZXkgaW4gb2JqKSkgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuXG4gIC8vIEludGVybmFsIHJlY3Vyc2l2ZSBjb21wYXJpc29uIGZ1bmN0aW9uIGZvciBgaXNFcXVhbGAuXG4gIHZhciBlcSA9IGZ1bmN0aW9uKGEsIGIsIGFTdGFjaywgYlN0YWNrKSB7XG4gICAgLy8gSWRlbnRpY2FsIG9iamVjdHMgYXJlIGVxdWFsLiBgMCA9PT0gLTBgLCBidXQgdGhleSBhcmVuJ3QgaWRlbnRpY2FsLlxuICAgIC8vIFNlZSB0aGUgW0hhcm1vbnkgYGVnYWxgIHByb3Bvc2FsXShodHRwOi8vd2lraS5lY21hc2NyaXB0Lm9yZy9kb2t1LnBocD9pZD1oYXJtb255OmVnYWwpLlxuICAgIGlmIChhID09PSBiKSByZXR1cm4gYSAhPT0gMCB8fCAxIC8gYSA9PT0gMSAvIGI7XG4gICAgLy8gQSBzdHJpY3QgY29tcGFyaXNvbiBpcyBuZWNlc3NhcnkgYmVjYXVzZSBgbnVsbCA9PSB1bmRlZmluZWRgLlxuICAgIGlmIChhID09IG51bGwgfHwgYiA9PSBudWxsKSByZXR1cm4gYSA9PT0gYjtcbiAgICAvLyBVbndyYXAgYW55IHdyYXBwZWQgb2JqZWN0cy5cbiAgICBpZiAoYSBpbnN0YW5jZW9mIF8pIGEgPSBhLl93cmFwcGVkO1xuICAgIGlmIChiIGluc3RhbmNlb2YgXykgYiA9IGIuX3dyYXBwZWQ7XG4gICAgLy8gQ29tcGFyZSBgW1tDbGFzc11dYCBuYW1lcy5cbiAgICB2YXIgY2xhc3NOYW1lID0gdG9TdHJpbmcuY2FsbChhKTtcbiAgICBpZiAoY2xhc3NOYW1lICE9PSB0b1N0cmluZy5jYWxsKGIpKSByZXR1cm4gZmFsc2U7XG4gICAgc3dpdGNoIChjbGFzc05hbWUpIHtcbiAgICAgIC8vIFN0cmluZ3MsIG51bWJlcnMsIHJlZ3VsYXIgZXhwcmVzc2lvbnMsIGRhdGVzLCBhbmQgYm9vbGVhbnMgYXJlIGNvbXBhcmVkIGJ5IHZhbHVlLlxuICAgICAgY2FzZSAnW29iamVjdCBSZWdFeHBdJzpcbiAgICAgIC8vIFJlZ0V4cHMgYXJlIGNvZXJjZWQgdG8gc3RyaW5ncyBmb3IgY29tcGFyaXNvbiAoTm90ZTogJycgKyAvYS9pID09PSAnL2EvaScpXG4gICAgICBjYXNlICdbb2JqZWN0IFN0cmluZ10nOlxuICAgICAgICAvLyBQcmltaXRpdmVzIGFuZCB0aGVpciBjb3JyZXNwb25kaW5nIG9iamVjdCB3cmFwcGVycyBhcmUgZXF1aXZhbGVudDsgdGh1cywgYFwiNVwiYCBpc1xuICAgICAgICAvLyBlcXVpdmFsZW50IHRvIGBuZXcgU3RyaW5nKFwiNVwiKWAuXG4gICAgICAgIHJldHVybiAnJyArIGEgPT09ICcnICsgYjtcbiAgICAgIGNhc2UgJ1tvYmplY3QgTnVtYmVyXSc6XG4gICAgICAgIC8vIGBOYU5gcyBhcmUgZXF1aXZhbGVudCwgYnV0IG5vbi1yZWZsZXhpdmUuXG4gICAgICAgIC8vIE9iamVjdChOYU4pIGlzIGVxdWl2YWxlbnQgdG8gTmFOXG4gICAgICAgIGlmICgrYSAhPT0gK2EpIHJldHVybiArYiAhPT0gK2I7XG4gICAgICAgIC8vIEFuIGBlZ2FsYCBjb21wYXJpc29uIGlzIHBlcmZvcm1lZCBmb3Igb3RoZXIgbnVtZXJpYyB2YWx1ZXMuXG4gICAgICAgIHJldHVybiArYSA9PT0gMCA/IDEgLyArYSA9PT0gMSAvIGIgOiArYSA9PT0gK2I7XG4gICAgICBjYXNlICdbb2JqZWN0IERhdGVdJzpcbiAgICAgIGNhc2UgJ1tvYmplY3QgQm9vbGVhbl0nOlxuICAgICAgICAvLyBDb2VyY2UgZGF0ZXMgYW5kIGJvb2xlYW5zIHRvIG51bWVyaWMgcHJpbWl0aXZlIHZhbHVlcy4gRGF0ZXMgYXJlIGNvbXBhcmVkIGJ5IHRoZWlyXG4gICAgICAgIC8vIG1pbGxpc2Vjb25kIHJlcHJlc2VudGF0aW9ucy4gTm90ZSB0aGF0IGludmFsaWQgZGF0ZXMgd2l0aCBtaWxsaXNlY29uZCByZXByZXNlbnRhdGlvbnNcbiAgICAgICAgLy8gb2YgYE5hTmAgYXJlIG5vdCBlcXVpdmFsZW50LlxuICAgICAgICByZXR1cm4gK2EgPT09ICtiO1xuICAgIH1cblxuICAgIHZhciBhcmVBcnJheXMgPSBjbGFzc05hbWUgPT09ICdbb2JqZWN0IEFycmF5XSc7XG4gICAgaWYgKCFhcmVBcnJheXMpIHtcbiAgICAgIGlmICh0eXBlb2YgYSAhPSAnb2JqZWN0JyB8fCB0eXBlb2YgYiAhPSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuXG4gICAgICAvLyBPYmplY3RzIHdpdGggZGlmZmVyZW50IGNvbnN0cnVjdG9ycyBhcmUgbm90IGVxdWl2YWxlbnQsIGJ1dCBgT2JqZWN0YHMgb3IgYEFycmF5YHNcbiAgICAgIC8vIGZyb20gZGlmZmVyZW50IGZyYW1lcyBhcmUuXG4gICAgICB2YXIgYUN0b3IgPSBhLmNvbnN0cnVjdG9yLCBiQ3RvciA9IGIuY29uc3RydWN0b3I7XG4gICAgICBpZiAoYUN0b3IgIT09IGJDdG9yICYmICEoXy5pc0Z1bmN0aW9uKGFDdG9yKSAmJiBhQ3RvciBpbnN0YW5jZW9mIGFDdG9yICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXy5pc0Z1bmN0aW9uKGJDdG9yKSAmJiBiQ3RvciBpbnN0YW5jZW9mIGJDdG9yKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAmJiAoJ2NvbnN0cnVjdG9yJyBpbiBhICYmICdjb25zdHJ1Y3RvcicgaW4gYikpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBBc3N1bWUgZXF1YWxpdHkgZm9yIGN5Y2xpYyBzdHJ1Y3R1cmVzLiBUaGUgYWxnb3JpdGhtIGZvciBkZXRlY3RpbmcgY3ljbGljXG4gICAgLy8gc3RydWN0dXJlcyBpcyBhZGFwdGVkIGZyb20gRVMgNS4xIHNlY3Rpb24gMTUuMTIuMywgYWJzdHJhY3Qgb3BlcmF0aW9uIGBKT2AuXG5cbiAgICAvLyBJbml0aWFsaXppbmcgc3RhY2sgb2YgdHJhdmVyc2VkIG9iamVjdHMuXG4gICAgLy8gSXQncyBkb25lIGhlcmUgc2luY2Ugd2Ugb25seSBuZWVkIHRoZW0gZm9yIG9iamVjdHMgYW5kIGFycmF5cyBjb21wYXJpc29uLlxuICAgIGFTdGFjayA9IGFTdGFjayB8fCBbXTtcbiAgICBiU3RhY2sgPSBiU3RhY2sgfHwgW107XG4gICAgdmFyIGxlbmd0aCA9IGFTdGFjay5sZW5ndGg7XG4gICAgd2hpbGUgKGxlbmd0aC0tKSB7XG4gICAgICAvLyBMaW5lYXIgc2VhcmNoLiBQZXJmb3JtYW5jZSBpcyBpbnZlcnNlbHkgcHJvcG9ydGlvbmFsIHRvIHRoZSBudW1iZXIgb2ZcbiAgICAgIC8vIHVuaXF1ZSBuZXN0ZWQgc3RydWN0dXJlcy5cbiAgICAgIGlmIChhU3RhY2tbbGVuZ3RoXSA9PT0gYSkgcmV0dXJuIGJTdGFja1tsZW5ndGhdID09PSBiO1xuICAgIH1cblxuICAgIC8vIEFkZCB0aGUgZmlyc3Qgb2JqZWN0IHRvIHRoZSBzdGFjayBvZiB0cmF2ZXJzZWQgb2JqZWN0cy5cbiAgICBhU3RhY2sucHVzaChhKTtcbiAgICBiU3RhY2sucHVzaChiKTtcblxuICAgIC8vIFJlY3Vyc2l2ZWx5IGNvbXBhcmUgb2JqZWN0cyBhbmQgYXJyYXlzLlxuICAgIGlmIChhcmVBcnJheXMpIHtcbiAgICAgIC8vIENvbXBhcmUgYXJyYXkgbGVuZ3RocyB0byBkZXRlcm1pbmUgaWYgYSBkZWVwIGNvbXBhcmlzb24gaXMgbmVjZXNzYXJ5LlxuICAgICAgbGVuZ3RoID0gYS5sZW5ndGg7XG4gICAgICBpZiAobGVuZ3RoICE9PSBiLmxlbmd0aCkgcmV0dXJuIGZhbHNlO1xuICAgICAgLy8gRGVlcCBjb21wYXJlIHRoZSBjb250ZW50cywgaWdub3Jpbmcgbm9uLW51bWVyaWMgcHJvcGVydGllcy5cbiAgICAgIHdoaWxlIChsZW5ndGgtLSkge1xuICAgICAgICBpZiAoIWVxKGFbbGVuZ3RoXSwgYltsZW5ndGhdLCBhU3RhY2ssIGJTdGFjaykpIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRGVlcCBjb21wYXJlIG9iamVjdHMuXG4gICAgICB2YXIga2V5cyA9IF8ua2V5cyhhKSwga2V5O1xuICAgICAgbGVuZ3RoID0ga2V5cy5sZW5ndGg7XG4gICAgICAvLyBFbnN1cmUgdGhhdCBib3RoIG9iamVjdHMgY29udGFpbiB0aGUgc2FtZSBudW1iZXIgb2YgcHJvcGVydGllcyBiZWZvcmUgY29tcGFyaW5nIGRlZXAgZXF1YWxpdHkuXG4gICAgICBpZiAoXy5rZXlzKGIpLmxlbmd0aCAhPT0gbGVuZ3RoKSByZXR1cm4gZmFsc2U7XG4gICAgICB3aGlsZSAobGVuZ3RoLS0pIHtcbiAgICAgICAgLy8gRGVlcCBjb21wYXJlIGVhY2ggbWVtYmVyXG4gICAgICAgIGtleSA9IGtleXNbbGVuZ3RoXTtcbiAgICAgICAgaWYgKCEoXy5oYXMoYiwga2V5KSAmJiBlcShhW2tleV0sIGJba2V5XSwgYVN0YWNrLCBiU3RhY2spKSkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBSZW1vdmUgdGhlIGZpcnN0IG9iamVjdCBmcm9tIHRoZSBzdGFjayBvZiB0cmF2ZXJzZWQgb2JqZWN0cy5cbiAgICBhU3RhY2sucG9wKCk7XG4gICAgYlN0YWNrLnBvcCgpO1xuICAgIHJldHVybiB0cnVlO1xuICB9O1xuXG4gIC8vIFBlcmZvcm0gYSBkZWVwIGNvbXBhcmlzb24gdG8gY2hlY2sgaWYgdHdvIG9iamVjdHMgYXJlIGVxdWFsLlxuICBfLmlzRXF1YWwgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgcmV0dXJuIGVxKGEsIGIpO1xuICB9O1xuXG4gIC8vIElzIGEgZ2l2ZW4gYXJyYXksIHN0cmluZywgb3Igb2JqZWN0IGVtcHR5P1xuICAvLyBBbiBcImVtcHR5XCIgb2JqZWN0IGhhcyBubyBlbnVtZXJhYmxlIG93bi1wcm9wZXJ0aWVzLlxuICBfLmlzRW1wdHkgPSBmdW5jdGlvbihvYmopIHtcbiAgICBpZiAob2JqID09IG51bGwpIHJldHVybiB0cnVlO1xuICAgIGlmIChpc0FycmF5TGlrZShvYmopICYmIChfLmlzQXJyYXkob2JqKSB8fCBfLmlzU3RyaW5nKG9iaikgfHwgXy5pc0FyZ3VtZW50cyhvYmopKSkgcmV0dXJuIG9iai5sZW5ndGggPT09IDA7XG4gICAgcmV0dXJuIF8ua2V5cyhvYmopLmxlbmd0aCA9PT0gMDtcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIHZhbHVlIGEgRE9NIGVsZW1lbnQ/XG4gIF8uaXNFbGVtZW50ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuICEhKG9iaiAmJiBvYmoubm9kZVR5cGUgPT09IDEpO1xuICB9O1xuXG4gIC8vIElzIGEgZ2l2ZW4gdmFsdWUgYW4gYXJyYXk/XG4gIC8vIERlbGVnYXRlcyB0byBFQ01BNSdzIG5hdGl2ZSBBcnJheS5pc0FycmF5XG4gIF8uaXNBcnJheSA9IG5hdGl2ZUlzQXJyYXkgfHwgZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIHRvU3RyaW5nLmNhbGwob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIHZhcmlhYmxlIGFuIG9iamVjdD9cbiAgXy5pc09iamVjdCA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHZhciB0eXBlID0gdHlwZW9mIG9iajtcbiAgICByZXR1cm4gdHlwZSA9PT0gJ2Z1bmN0aW9uJyB8fCB0eXBlID09PSAnb2JqZWN0JyAmJiAhIW9iajtcbiAgfTtcblxuICAvLyBBZGQgc29tZSBpc1R5cGUgbWV0aG9kczogaXNBcmd1bWVudHMsIGlzRnVuY3Rpb24sIGlzU3RyaW5nLCBpc051bWJlciwgaXNEYXRlLCBpc1JlZ0V4cCwgaXNFcnJvci5cbiAgXy5lYWNoKFsnQXJndW1lbnRzJywgJ0Z1bmN0aW9uJywgJ1N0cmluZycsICdOdW1iZXInLCAnRGF0ZScsICdSZWdFeHAnLCAnRXJyb3InXSwgZnVuY3Rpb24obmFtZSkge1xuICAgIF9bJ2lzJyArIG5hbWVdID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gdG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCAnICsgbmFtZSArICddJztcbiAgICB9O1xuICB9KTtcblxuICAvLyBEZWZpbmUgYSBmYWxsYmFjayB2ZXJzaW9uIG9mIHRoZSBtZXRob2QgaW4gYnJvd3NlcnMgKGFoZW0sIElFIDwgOSksIHdoZXJlXG4gIC8vIHRoZXJlIGlzbid0IGFueSBpbnNwZWN0YWJsZSBcIkFyZ3VtZW50c1wiIHR5cGUuXG4gIGlmICghXy5pc0FyZ3VtZW50cyhhcmd1bWVudHMpKSB7XG4gICAgXy5pc0FyZ3VtZW50cyA9IGZ1bmN0aW9uKG9iaikge1xuICAgICAgcmV0dXJuIF8uaGFzKG9iaiwgJ2NhbGxlZScpO1xuICAgIH07XG4gIH1cblxuICAvLyBPcHRpbWl6ZSBgaXNGdW5jdGlvbmAgaWYgYXBwcm9wcmlhdGUuIFdvcmsgYXJvdW5kIHNvbWUgdHlwZW9mIGJ1Z3MgaW4gb2xkIHY4LFxuICAvLyBJRSAxMSAoIzE2MjEpLCBhbmQgaW4gU2FmYXJpIDggKCMxOTI5KS5cbiAgaWYgKHR5cGVvZiAvLi8gIT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgSW50OEFycmF5ICE9ICdvYmplY3QnKSB7XG4gICAgXy5pc0Z1bmN0aW9uID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gdHlwZW9mIG9iaiA9PSAnZnVuY3Rpb24nIHx8IGZhbHNlO1xuICAgIH07XG4gIH1cblxuICAvLyBJcyBhIGdpdmVuIG9iamVjdCBhIGZpbml0ZSBudW1iZXI/XG4gIF8uaXNGaW5pdGUgPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gaXNGaW5pdGUob2JqKSAmJiAhaXNOYU4ocGFyc2VGbG9hdChvYmopKTtcbiAgfTtcblxuICAvLyBJcyB0aGUgZ2l2ZW4gdmFsdWUgYE5hTmA/IChOYU4gaXMgdGhlIG9ubHkgbnVtYmVyIHdoaWNoIGRvZXMgbm90IGVxdWFsIGl0c2VsZikuXG4gIF8uaXNOYU4gPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gXy5pc051bWJlcihvYmopICYmIG9iaiAhPT0gK29iajtcbiAgfTtcblxuICAvLyBJcyBhIGdpdmVuIHZhbHVlIGEgYm9vbGVhbj9cbiAgXy5pc0Jvb2xlYW4gPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gb2JqID09PSB0cnVlIHx8IG9iaiA9PT0gZmFsc2UgfHwgdG9TdHJpbmcuY2FsbChvYmopID09PSAnW29iamVjdCBCb29sZWFuXSc7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YWx1ZSBlcXVhbCB0byBudWxsP1xuICBfLmlzTnVsbCA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiBvYmogPT09IG51bGw7XG4gIH07XG5cbiAgLy8gSXMgYSBnaXZlbiB2YXJpYWJsZSB1bmRlZmluZWQ/XG4gIF8uaXNVbmRlZmluZWQgPSBmdW5jdGlvbihvYmopIHtcbiAgICByZXR1cm4gb2JqID09PSB2b2lkIDA7XG4gIH07XG5cbiAgLy8gU2hvcnRjdXQgZnVuY3Rpb24gZm9yIGNoZWNraW5nIGlmIGFuIG9iamVjdCBoYXMgYSBnaXZlbiBwcm9wZXJ0eSBkaXJlY3RseVxuICAvLyBvbiBpdHNlbGYgKGluIG90aGVyIHdvcmRzLCBub3Qgb24gYSBwcm90b3R5cGUpLlxuICBfLmhhcyA9IGZ1bmN0aW9uKG9iaiwga2V5KSB7XG4gICAgcmV0dXJuIG9iaiAhPSBudWxsICYmIGhhc093blByb3BlcnR5LmNhbGwob2JqLCBrZXkpO1xuICB9O1xuXG4gIC8vIFV0aWxpdHkgRnVuY3Rpb25zXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLy8gUnVuIFVuZGVyc2NvcmUuanMgaW4gKm5vQ29uZmxpY3QqIG1vZGUsIHJldHVybmluZyB0aGUgYF9gIHZhcmlhYmxlIHRvIGl0c1xuICAvLyBwcmV2aW91cyBvd25lci4gUmV0dXJucyBhIHJlZmVyZW5jZSB0byB0aGUgVW5kZXJzY29yZSBvYmplY3QuXG4gIF8ubm9Db25mbGljdCA9IGZ1bmN0aW9uKCkge1xuICAgIHJvb3QuXyA9IHByZXZpb3VzVW5kZXJzY29yZTtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcblxuICAvLyBLZWVwIHRoZSBpZGVudGl0eSBmdW5jdGlvbiBhcm91bmQgZm9yIGRlZmF1bHQgaXRlcmF0ZWVzLlxuICBfLmlkZW50aXR5ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH07XG5cbiAgLy8gUHJlZGljYXRlLWdlbmVyYXRpbmcgZnVuY3Rpb25zLiBPZnRlbiB1c2VmdWwgb3V0c2lkZSBvZiBVbmRlcnNjb3JlLlxuICBfLmNvbnN0YW50ID0gZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfTtcbiAgfTtcblxuICBfLm5vb3AgPSBmdW5jdGlvbigpe307XG5cbiAgXy5wcm9wZXJ0eSA9IHByb3BlcnR5O1xuXG4gIC8vIEdlbmVyYXRlcyBhIGZ1bmN0aW9uIGZvciBhIGdpdmVuIG9iamVjdCB0aGF0IHJldHVybnMgYSBnaXZlbiBwcm9wZXJ0eS5cbiAgXy5wcm9wZXJ0eU9mID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIG9iaiA9PSBudWxsID8gZnVuY3Rpb24oKXt9IDogZnVuY3Rpb24oa2V5KSB7XG4gICAgICByZXR1cm4gb2JqW2tleV07XG4gICAgfTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIGEgcHJlZGljYXRlIGZvciBjaGVja2luZyB3aGV0aGVyIGFuIG9iamVjdCBoYXMgYSBnaXZlbiBzZXQgb2ZcbiAgLy8gYGtleTp2YWx1ZWAgcGFpcnMuXG4gIF8ubWF0Y2hlciA9IF8ubWF0Y2hlcyA9IGZ1bmN0aW9uKGF0dHJzKSB7XG4gICAgYXR0cnMgPSBfLmV4dGVuZE93bih7fSwgYXR0cnMpO1xuICAgIHJldHVybiBmdW5jdGlvbihvYmopIHtcbiAgICAgIHJldHVybiBfLmlzTWF0Y2gob2JqLCBhdHRycyk7XG4gICAgfTtcbiAgfTtcblxuICAvLyBSdW4gYSBmdW5jdGlvbiAqKm4qKiB0aW1lcy5cbiAgXy50aW1lcyA9IGZ1bmN0aW9uKG4sIGl0ZXJhdGVlLCBjb250ZXh0KSB7XG4gICAgdmFyIGFjY3VtID0gQXJyYXkoTWF0aC5tYXgoMCwgbikpO1xuICAgIGl0ZXJhdGVlID0gb3B0aW1pemVDYihpdGVyYXRlZSwgY29udGV4dCwgMSk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBuOyBpKyspIGFjY3VtW2ldID0gaXRlcmF0ZWUoaSk7XG4gICAgcmV0dXJuIGFjY3VtO1xuICB9O1xuXG4gIC8vIFJldHVybiBhIHJhbmRvbSBpbnRlZ2VyIGJldHdlZW4gbWluIGFuZCBtYXggKGluY2x1c2l2ZSkuXG4gIF8ucmFuZG9tID0gZnVuY3Rpb24obWluLCBtYXgpIHtcbiAgICBpZiAobWF4ID09IG51bGwpIHtcbiAgICAgIG1heCA9IG1pbjtcbiAgICAgIG1pbiA9IDA7XG4gICAgfVxuICAgIHJldHVybiBtaW4gKyBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAobWF4IC0gbWluICsgMSkpO1xuICB9O1xuXG4gIC8vIEEgKHBvc3NpYmx5IGZhc3Rlcikgd2F5IHRvIGdldCB0aGUgY3VycmVudCB0aW1lc3RhbXAgYXMgYW4gaW50ZWdlci5cbiAgXy5ub3cgPSBEYXRlLm5vdyB8fCBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gIH07XG5cbiAgIC8vIExpc3Qgb2YgSFRNTCBlbnRpdGllcyBmb3IgZXNjYXBpbmcuXG4gIHZhciBlc2NhcGVNYXAgPSB7XG4gICAgJyYnOiAnJmFtcDsnLFxuICAgICc8JzogJyZsdDsnLFxuICAgICc+JzogJyZndDsnLFxuICAgICdcIic6ICcmcXVvdDsnLFxuICAgIFwiJ1wiOiAnJiN4Mjc7JyxcbiAgICAnYCc6ICcmI3g2MDsnXG4gIH07XG4gIHZhciB1bmVzY2FwZU1hcCA9IF8uaW52ZXJ0KGVzY2FwZU1hcCk7XG5cbiAgLy8gRnVuY3Rpb25zIGZvciBlc2NhcGluZyBhbmQgdW5lc2NhcGluZyBzdHJpbmdzIHRvL2Zyb20gSFRNTCBpbnRlcnBvbGF0aW9uLlxuICB2YXIgY3JlYXRlRXNjYXBlciA9IGZ1bmN0aW9uKG1hcCkge1xuICAgIHZhciBlc2NhcGVyID0gZnVuY3Rpb24obWF0Y2gpIHtcbiAgICAgIHJldHVybiBtYXBbbWF0Y2hdO1xuICAgIH07XG4gICAgLy8gUmVnZXhlcyBmb3IgaWRlbnRpZnlpbmcgYSBrZXkgdGhhdCBuZWVkcyB0byBiZSBlc2NhcGVkXG4gICAgdmFyIHNvdXJjZSA9ICcoPzonICsgXy5rZXlzKG1hcCkuam9pbignfCcpICsgJyknO1xuICAgIHZhciB0ZXN0UmVnZXhwID0gUmVnRXhwKHNvdXJjZSk7XG4gICAgdmFyIHJlcGxhY2VSZWdleHAgPSBSZWdFeHAoc291cmNlLCAnZycpO1xuICAgIHJldHVybiBmdW5jdGlvbihzdHJpbmcpIHtcbiAgICAgIHN0cmluZyA9IHN0cmluZyA9PSBudWxsID8gJycgOiAnJyArIHN0cmluZztcbiAgICAgIHJldHVybiB0ZXN0UmVnZXhwLnRlc3Qoc3RyaW5nKSA/IHN0cmluZy5yZXBsYWNlKHJlcGxhY2VSZWdleHAsIGVzY2FwZXIpIDogc3RyaW5nO1xuICAgIH07XG4gIH07XG4gIF8uZXNjYXBlID0gY3JlYXRlRXNjYXBlcihlc2NhcGVNYXApO1xuICBfLnVuZXNjYXBlID0gY3JlYXRlRXNjYXBlcih1bmVzY2FwZU1hcCk7XG5cbiAgLy8gSWYgdGhlIHZhbHVlIG9mIHRoZSBuYW1lZCBgcHJvcGVydHlgIGlzIGEgZnVuY3Rpb24gdGhlbiBpbnZva2UgaXQgd2l0aCB0aGVcbiAgLy8gYG9iamVjdGAgYXMgY29udGV4dDsgb3RoZXJ3aXNlLCByZXR1cm4gaXQuXG4gIF8ucmVzdWx0ID0gZnVuY3Rpb24ob2JqZWN0LCBwcm9wZXJ0eSwgZmFsbGJhY2spIHtcbiAgICB2YXIgdmFsdWUgPSBvYmplY3QgPT0gbnVsbCA/IHZvaWQgMCA6IG9iamVjdFtwcm9wZXJ0eV07XG4gICAgaWYgKHZhbHVlID09PSB2b2lkIDApIHtcbiAgICAgIHZhbHVlID0gZmFsbGJhY2s7XG4gICAgfVxuICAgIHJldHVybiBfLmlzRnVuY3Rpb24odmFsdWUpID8gdmFsdWUuY2FsbChvYmplY3QpIDogdmFsdWU7XG4gIH07XG5cbiAgLy8gR2VuZXJhdGUgYSB1bmlxdWUgaW50ZWdlciBpZCAodW5pcXVlIHdpdGhpbiB0aGUgZW50aXJlIGNsaWVudCBzZXNzaW9uKS5cbiAgLy8gVXNlZnVsIGZvciB0ZW1wb3JhcnkgRE9NIGlkcy5cbiAgdmFyIGlkQ291bnRlciA9IDA7XG4gIF8udW5pcXVlSWQgPSBmdW5jdGlvbihwcmVmaXgpIHtcbiAgICB2YXIgaWQgPSArK2lkQ291bnRlciArICcnO1xuICAgIHJldHVybiBwcmVmaXggPyBwcmVmaXggKyBpZCA6IGlkO1xuICB9O1xuXG4gIC8vIEJ5IGRlZmF1bHQsIFVuZGVyc2NvcmUgdXNlcyBFUkItc3R5bGUgdGVtcGxhdGUgZGVsaW1pdGVycywgY2hhbmdlIHRoZVxuICAvLyBmb2xsb3dpbmcgdGVtcGxhdGUgc2V0dGluZ3MgdG8gdXNlIGFsdGVybmF0aXZlIGRlbGltaXRlcnMuXG4gIF8udGVtcGxhdGVTZXR0aW5ncyA9IHtcbiAgICBldmFsdWF0ZSAgICA6IC88JShbXFxzXFxTXSs/KSU+L2csXG4gICAgaW50ZXJwb2xhdGUgOiAvPCU9KFtcXHNcXFNdKz8pJT4vZyxcbiAgICBlc2NhcGUgICAgICA6IC88JS0oW1xcc1xcU10rPyklPi9nXG4gIH07XG5cbiAgLy8gV2hlbiBjdXN0b21pemluZyBgdGVtcGxhdGVTZXR0aW5nc2AsIGlmIHlvdSBkb24ndCB3YW50IHRvIGRlZmluZSBhblxuICAvLyBpbnRlcnBvbGF0aW9uLCBldmFsdWF0aW9uIG9yIGVzY2FwaW5nIHJlZ2V4LCB3ZSBuZWVkIG9uZSB0aGF0IGlzXG4gIC8vIGd1YXJhbnRlZWQgbm90IHRvIG1hdGNoLlxuICB2YXIgbm9NYXRjaCA9IC8oLileLztcblxuICAvLyBDZXJ0YWluIGNoYXJhY3RlcnMgbmVlZCB0byBiZSBlc2NhcGVkIHNvIHRoYXQgdGhleSBjYW4gYmUgcHV0IGludG8gYVxuICAvLyBzdHJpbmcgbGl0ZXJhbC5cbiAgdmFyIGVzY2FwZXMgPSB7XG4gICAgXCInXCI6ICAgICAgXCInXCIsXG4gICAgJ1xcXFwnOiAgICAgJ1xcXFwnLFxuICAgICdcXHInOiAgICAgJ3InLFxuICAgICdcXG4nOiAgICAgJ24nLFxuICAgICdcXHUyMDI4JzogJ3UyMDI4JyxcbiAgICAnXFx1MjAyOSc6ICd1MjAyOSdcbiAgfTtcblxuICB2YXIgZXNjYXBlciA9IC9cXFxcfCd8XFxyfFxcbnxcXHUyMDI4fFxcdTIwMjkvZztcblxuICB2YXIgZXNjYXBlQ2hhciA9IGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgcmV0dXJuICdcXFxcJyArIGVzY2FwZXNbbWF0Y2hdO1xuICB9O1xuXG4gIC8vIEphdmFTY3JpcHQgbWljcm8tdGVtcGxhdGluZywgc2ltaWxhciB0byBKb2huIFJlc2lnJ3MgaW1wbGVtZW50YXRpb24uXG4gIC8vIFVuZGVyc2NvcmUgdGVtcGxhdGluZyBoYW5kbGVzIGFyYml0cmFyeSBkZWxpbWl0ZXJzLCBwcmVzZXJ2ZXMgd2hpdGVzcGFjZSxcbiAgLy8gYW5kIGNvcnJlY3RseSBlc2NhcGVzIHF1b3RlcyB3aXRoaW4gaW50ZXJwb2xhdGVkIGNvZGUuXG4gIC8vIE5COiBgb2xkU2V0dGluZ3NgIG9ubHkgZXhpc3RzIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eS5cbiAgXy50ZW1wbGF0ZSA9IGZ1bmN0aW9uKHRleHQsIHNldHRpbmdzLCBvbGRTZXR0aW5ncykge1xuICAgIGlmICghc2V0dGluZ3MgJiYgb2xkU2V0dGluZ3MpIHNldHRpbmdzID0gb2xkU2V0dGluZ3M7XG4gICAgc2V0dGluZ3MgPSBfLmRlZmF1bHRzKHt9LCBzZXR0aW5ncywgXy50ZW1wbGF0ZVNldHRpbmdzKTtcblxuICAgIC8vIENvbWJpbmUgZGVsaW1pdGVycyBpbnRvIG9uZSByZWd1bGFyIGV4cHJlc3Npb24gdmlhIGFsdGVybmF0aW9uLlxuICAgIHZhciBtYXRjaGVyID0gUmVnRXhwKFtcbiAgICAgIChzZXR0aW5ncy5lc2NhcGUgfHwgbm9NYXRjaCkuc291cmNlLFxuICAgICAgKHNldHRpbmdzLmludGVycG9sYXRlIHx8IG5vTWF0Y2gpLnNvdXJjZSxcbiAgICAgIChzZXR0aW5ncy5ldmFsdWF0ZSB8fCBub01hdGNoKS5zb3VyY2VcbiAgICBdLmpvaW4oJ3wnKSArICd8JCcsICdnJyk7XG5cbiAgICAvLyBDb21waWxlIHRoZSB0ZW1wbGF0ZSBzb3VyY2UsIGVzY2FwaW5nIHN0cmluZyBsaXRlcmFscyBhcHByb3ByaWF0ZWx5LlxuICAgIHZhciBpbmRleCA9IDA7XG4gICAgdmFyIHNvdXJjZSA9IFwiX19wKz0nXCI7XG4gICAgdGV4dC5yZXBsYWNlKG1hdGNoZXIsIGZ1bmN0aW9uKG1hdGNoLCBlc2NhcGUsIGludGVycG9sYXRlLCBldmFsdWF0ZSwgb2Zmc2V0KSB7XG4gICAgICBzb3VyY2UgKz0gdGV4dC5zbGljZShpbmRleCwgb2Zmc2V0KS5yZXBsYWNlKGVzY2FwZXIsIGVzY2FwZUNoYXIpO1xuICAgICAgaW5kZXggPSBvZmZzZXQgKyBtYXRjaC5sZW5ndGg7XG5cbiAgICAgIGlmIChlc2NhcGUpIHtcbiAgICAgICAgc291cmNlICs9IFwiJytcXG4oKF9fdD0oXCIgKyBlc2NhcGUgKyBcIikpPT1udWxsPycnOl8uZXNjYXBlKF9fdCkpK1xcbidcIjtcbiAgICAgIH0gZWxzZSBpZiAoaW50ZXJwb2xhdGUpIHtcbiAgICAgICAgc291cmNlICs9IFwiJytcXG4oKF9fdD0oXCIgKyBpbnRlcnBvbGF0ZSArIFwiKSk9PW51bGw/Jyc6X190KStcXG4nXCI7XG4gICAgICB9IGVsc2UgaWYgKGV2YWx1YXRlKSB7XG4gICAgICAgIHNvdXJjZSArPSBcIic7XFxuXCIgKyBldmFsdWF0ZSArIFwiXFxuX19wKz0nXCI7XG4gICAgICB9XG5cbiAgICAgIC8vIEFkb2JlIFZNcyBuZWVkIHRoZSBtYXRjaCByZXR1cm5lZCB0byBwcm9kdWNlIHRoZSBjb3JyZWN0IG9mZmVzdC5cbiAgICAgIHJldHVybiBtYXRjaDtcbiAgICB9KTtcbiAgICBzb3VyY2UgKz0gXCInO1xcblwiO1xuXG4gICAgLy8gSWYgYSB2YXJpYWJsZSBpcyBub3Qgc3BlY2lmaWVkLCBwbGFjZSBkYXRhIHZhbHVlcyBpbiBsb2NhbCBzY29wZS5cbiAgICBpZiAoIXNldHRpbmdzLnZhcmlhYmxlKSBzb3VyY2UgPSAnd2l0aChvYmp8fHt9KXtcXG4nICsgc291cmNlICsgJ31cXG4nO1xuXG4gICAgc291cmNlID0gXCJ2YXIgX190LF9fcD0nJyxfX2o9QXJyYXkucHJvdG90eXBlLmpvaW4sXCIgK1xuICAgICAgXCJwcmludD1mdW5jdGlvbigpe19fcCs9X19qLmNhbGwoYXJndW1lbnRzLCcnKTt9O1xcblwiICtcbiAgICAgIHNvdXJjZSArICdyZXR1cm4gX19wO1xcbic7XG5cbiAgICB0cnkge1xuICAgICAgdmFyIHJlbmRlciA9IG5ldyBGdW5jdGlvbihzZXR0aW5ncy52YXJpYWJsZSB8fCAnb2JqJywgJ18nLCBzb3VyY2UpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGUuc291cmNlID0gc291cmNlO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG5cbiAgICB2YXIgdGVtcGxhdGUgPSBmdW5jdGlvbihkYXRhKSB7XG4gICAgICByZXR1cm4gcmVuZGVyLmNhbGwodGhpcywgZGF0YSwgXyk7XG4gICAgfTtcblxuICAgIC8vIFByb3ZpZGUgdGhlIGNvbXBpbGVkIHNvdXJjZSBhcyBhIGNvbnZlbmllbmNlIGZvciBwcmVjb21waWxhdGlvbi5cbiAgICB2YXIgYXJndW1lbnQgPSBzZXR0aW5ncy52YXJpYWJsZSB8fCAnb2JqJztcbiAgICB0ZW1wbGF0ZS5zb3VyY2UgPSAnZnVuY3Rpb24oJyArIGFyZ3VtZW50ICsgJyl7XFxuJyArIHNvdXJjZSArICd9JztcblxuICAgIHJldHVybiB0ZW1wbGF0ZTtcbiAgfTtcblxuICAvLyBBZGQgYSBcImNoYWluXCIgZnVuY3Rpb24uIFN0YXJ0IGNoYWluaW5nIGEgd3JhcHBlZCBVbmRlcnNjb3JlIG9iamVjdC5cbiAgXy5jaGFpbiA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHZhciBpbnN0YW5jZSA9IF8ob2JqKTtcbiAgICBpbnN0YW5jZS5fY2hhaW4gPSB0cnVlO1xuICAgIHJldHVybiBpbnN0YW5jZTtcbiAgfTtcblxuICAvLyBPT1BcbiAgLy8gLS0tLS0tLS0tLS0tLS0tXG4gIC8vIElmIFVuZGVyc2NvcmUgaXMgY2FsbGVkIGFzIGEgZnVuY3Rpb24sIGl0IHJldHVybnMgYSB3cmFwcGVkIG9iamVjdCB0aGF0XG4gIC8vIGNhbiBiZSB1c2VkIE9PLXN0eWxlLiBUaGlzIHdyYXBwZXIgaG9sZHMgYWx0ZXJlZCB2ZXJzaW9ucyBvZiBhbGwgdGhlXG4gIC8vIHVuZGVyc2NvcmUgZnVuY3Rpb25zLiBXcmFwcGVkIG9iamVjdHMgbWF5IGJlIGNoYWluZWQuXG5cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNvbnRpbnVlIGNoYWluaW5nIGludGVybWVkaWF0ZSByZXN1bHRzLlxuICB2YXIgcmVzdWx0ID0gZnVuY3Rpb24oaW5zdGFuY2UsIG9iaikge1xuICAgIHJldHVybiBpbnN0YW5jZS5fY2hhaW4gPyBfKG9iaikuY2hhaW4oKSA6IG9iajtcbiAgfTtcblxuICAvLyBBZGQgeW91ciBvd24gY3VzdG9tIGZ1bmN0aW9ucyB0byB0aGUgVW5kZXJzY29yZSBvYmplY3QuXG4gIF8ubWl4aW4gPSBmdW5jdGlvbihvYmopIHtcbiAgICBfLmVhY2goXy5mdW5jdGlvbnMob2JqKSwgZnVuY3Rpb24obmFtZSkge1xuICAgICAgdmFyIGZ1bmMgPSBfW25hbWVdID0gb2JqW25hbWVdO1xuICAgICAgXy5wcm90b3R5cGVbbmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGFyZ3MgPSBbdGhpcy5fd3JhcHBlZF07XG4gICAgICAgIHB1c2guYXBwbHkoYXJncywgYXJndW1lbnRzKTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdCh0aGlzLCBmdW5jLmFwcGx5KF8sIGFyZ3MpKTtcbiAgICAgIH07XG4gICAgfSk7XG4gIH07XG5cbiAgLy8gQWRkIGFsbCBvZiB0aGUgVW5kZXJzY29yZSBmdW5jdGlvbnMgdG8gdGhlIHdyYXBwZXIgb2JqZWN0LlxuICBfLm1peGluKF8pO1xuXG4gIC8vIEFkZCBhbGwgbXV0YXRvciBBcnJheSBmdW5jdGlvbnMgdG8gdGhlIHdyYXBwZXIuXG4gIF8uZWFjaChbJ3BvcCcsICdwdXNoJywgJ3JldmVyc2UnLCAnc2hpZnQnLCAnc29ydCcsICdzcGxpY2UnLCAndW5zaGlmdCddLCBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIG1ldGhvZCA9IEFycmF5UHJvdG9bbmFtZV07XG4gICAgXy5wcm90b3R5cGVbbmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBvYmogPSB0aGlzLl93cmFwcGVkO1xuICAgICAgbWV0aG9kLmFwcGx5KG9iaiwgYXJndW1lbnRzKTtcbiAgICAgIGlmICgobmFtZSA9PT0gJ3NoaWZ0JyB8fCBuYW1lID09PSAnc3BsaWNlJykgJiYgb2JqLmxlbmd0aCA9PT0gMCkgZGVsZXRlIG9ialswXTtcbiAgICAgIHJldHVybiByZXN1bHQodGhpcywgb2JqKTtcbiAgICB9O1xuICB9KTtcblxuICAvLyBBZGQgYWxsIGFjY2Vzc29yIEFycmF5IGZ1bmN0aW9ucyB0byB0aGUgd3JhcHBlci5cbiAgXy5lYWNoKFsnY29uY2F0JywgJ2pvaW4nLCAnc2xpY2UnXSwgZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBtZXRob2QgPSBBcnJheVByb3RvW25hbWVdO1xuICAgIF8ucHJvdG90eXBlW25hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gcmVzdWx0KHRoaXMsIG1ldGhvZC5hcHBseSh0aGlzLl93cmFwcGVkLCBhcmd1bWVudHMpKTtcbiAgICB9O1xuICB9KTtcblxuICAvLyBFeHRyYWN0cyB0aGUgcmVzdWx0IGZyb20gYSB3cmFwcGVkIGFuZCBjaGFpbmVkIG9iamVjdC5cbiAgXy5wcm90b3R5cGUudmFsdWUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fd3JhcHBlZDtcbiAgfTtcblxuICAvLyBQcm92aWRlIHVud3JhcHBpbmcgcHJveHkgZm9yIHNvbWUgbWV0aG9kcyB1c2VkIGluIGVuZ2luZSBvcGVyYXRpb25zXG4gIC8vIHN1Y2ggYXMgYXJpdGhtZXRpYyBhbmQgSlNPTiBzdHJpbmdpZmljYXRpb24uXG4gIF8ucHJvdG90eXBlLnZhbHVlT2YgPSBfLnByb3RvdHlwZS50b0pTT04gPSBfLnByb3RvdHlwZS52YWx1ZTtcblxuICBfLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiAnJyArIHRoaXMuX3dyYXBwZWQ7XG4gIH07XG5cbiAgLy8gQU1EIHJlZ2lzdHJhdGlvbiBoYXBwZW5zIGF0IHRoZSBlbmQgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBBTUQgbG9hZGVyc1xuICAvLyB0aGF0IG1heSBub3QgZW5mb3JjZSBuZXh0LXR1cm4gc2VtYW50aWNzIG9uIG1vZHVsZXMuIEV2ZW4gdGhvdWdoIGdlbmVyYWxcbiAgLy8gcHJhY3RpY2UgZm9yIEFNRCByZWdpc3RyYXRpb24gaXMgdG8gYmUgYW5vbnltb3VzLCB1bmRlcnNjb3JlIHJlZ2lzdGVyc1xuICAvLyBhcyBhIG5hbWVkIG1vZHVsZSBiZWNhdXNlLCBsaWtlIGpRdWVyeSwgaXQgaXMgYSBiYXNlIGxpYnJhcnkgdGhhdCBpc1xuICAvLyBwb3B1bGFyIGVub3VnaCB0byBiZSBidW5kbGVkIGluIGEgdGhpcmQgcGFydHkgbGliLCBidXQgbm90IGJlIHBhcnQgb2ZcbiAgLy8gYW4gQU1EIGxvYWQgcmVxdWVzdC4gVGhvc2UgY2FzZXMgY291bGQgZ2VuZXJhdGUgYW4gZXJyb3Igd2hlbiBhblxuICAvLyBhbm9ueW1vdXMgZGVmaW5lKCkgaXMgY2FsbGVkIG91dHNpZGUgb2YgYSBsb2FkZXIgcmVxdWVzdC5cbiAgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgIGRlZmluZSgndW5kZXJzY29yZScsIFtdLCBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBfO1xuICAgIH0pO1xuICB9XG59LmNhbGwodGhpcykpO1xuIiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIEdyYXBoID0gcmVxdWlyZSgnbmdyYXBoLmdyYXBoJyk7XHJcbnZhciBfID0gcmVxdWlyZSgndW5kZXJzY29yZScpO1xyXG52YXIgTmxheW91dCA9IHJlcXVpcmUoJ25ncmFwaC5mb3JjZWxheW91dC52MicpO1xyXG52YXIgVGhyZWFkO1xyXG4vLyByZWdpc3RlcnMgdGhlIGV4dGVuc2lvbiBvbiBhIGN5dG9zY2FwZSBsaWIgcmVmXHJcbnZhciBuZ3JhcGggPSBmdW5jdGlvbiAoY3l0b3NjYXBlKSB7XHJcblxyXG4gICAgaWYgKCFjeXRvc2NhcGUpIHtcclxuICAgICAgICByZXR1cm47XHJcbiAgICB9IC8vIGNhbid0IHJlZ2lzdGVyIGlmIGN5dG9zY2FwZSB1bnNwZWNpZmllZFxyXG5cclxuICAgIHZhciBkZWZhdWx0cyA9IHtcclxuICAgICAgICBzcHJpbmdMZW5ndGg6IDMwMCxcclxuICAgICAgICBzcHJpbmdDb2VmZjogMC4wMDA4LFxyXG4gICAgICAgIGdyYXZpdHk6IC0xLjIsXHJcbiAgICAgICAgdGhldGE6IDAuOCxcclxuICAgICAgICBhbmltYXRlOiB0cnVlLFxyXG4gICAgICAgIGRyYWdDb2VmZjogMC4wMixcclxuICAgICAgICB0aW1lU3RlcDogMzAsXHJcbiAgICAgICAgc3RhYmxlVGhyZXNob2xkOiAwLjA5LFxyXG4gICAgICAgIGl0ZXJhdGlvbnM6IDEwMCxcclxuICAgICAgICByZWZyZXNoSW50ZXJ2YWw6IDUsIC8vIGluIG1zXHJcbiAgICAgICAgcmVmcmVzaEl0ZXJhdGlvbnM6IDEwLCAvLyBpdGVyYXRpb25zIHVudGlsIHRocmVhZCBzZW5kcyBhbiB1cGRhdGVcclxuICAgICAgICBmaXQ6IHRydWVcclxuICAgIH07XHJcblxyXG4gICAgdmFyIGV4dGVuZCA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gKHRndCkge1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgdmFyIG9iaiA9IGFyZ3VtZW50c1tpXTtcclxuXHJcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBrIGluIG9iaikge1xyXG4gICAgICAgICAgICAgICAgICAgIHRndFtrXSA9IG9ialtrXTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRndDtcclxuICAgICAgICB9O1xyXG5cclxuICAgIGZ1bmN0aW9uIExheW91dChvcHRpb25zKSB7XHJcbiAgICAgICAgdGhpcy5vcHRpb25zID0gZXh0ZW5kKHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XHJcbiAgICB9XHJcblxyXG4gICAgTGF5b3V0LnByb3RvdHlwZS5sID0gTmxheW91dDtcclxuICAgIExheW91dC5wcm90b3R5cGUuZyA9IEdyYXBoO1xyXG5cclxuICAgIExheW91dC5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xyXG4gICAgICAgIHZhciBsYXlvdXQgPSB0aGlzO1xyXG4gICAgICAgIGxheW91dC50cmlnZ2VyKHt0eXBlOiAnbGF5b3V0c3RhcnQnLCBsYXlvdXQ6IGxheW91dH0pO1xyXG5cclxuXHJcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB0aGlzLm9wdGlvbnM7XHJcbiAgICAgICAgdmFyIHRoYXQgPSB0aGlzO1xyXG4gICAgICAgIHZhciBncmFwaCA9IHRoYXQuZygpO1xyXG4gICAgICAgIHZhciBjeSA9IG9wdGlvbnMuY3k7XHJcbiAgICAgICAgdmFyIGVsZXMgPSBvcHRpb25zLmVsZXM7XHJcbiAgICAgICAgdmFyIG5vZGVzID0gZWxlcy5ub2RlcygpO1xyXG4gICAgICAgIHZhciBwYXJlbnRzID0gbm9kZXMucGFyZW50cygpO1xyXG4gICAgICAgIG5vZGVzID0gbm9kZXMuZGlmZmVyZW5jZShwYXJlbnRzKTtcclxuICAgICAgICB2YXIgZWRnZXMgPSBlbGVzLmVkZ2VzKCk7XHJcblxyXG4gICAgICAgIHZhciBlZGdlc0hhc2g9e307XHJcbiAgICAgICAgdmFyIGZpcnN0VXBkYXRlID0gdHJ1ZTtcclxuXHJcbi8qICAgICAgICBpZiAoZWxlcy5sZW5ndGggPiAzMDAwKSB7XHJcbiAgICAgICAgICAgIG9wdGlvbnMuaXRlcmF0aW9ucyA9IG9wdGlvbnMuaXRlcmF0aW9ucyAtIE1hdGguYWJzKG9wdGlvbnMuaXRlcmF0aW9ucyAvIDMpOyAvLyByZWR1Y2UgaXRlcmF0aW9ucyBmb3IgYmlnIGdyYXBoXHJcbiAgICAgICAgfSovXHJcblxyXG4gICAgICAgIHZhciB1cGRhdGUgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGN5LmJhdGNoKGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgICAgIG5vZGVzLnBvc2l0aW9ucyhmdW5jdGlvbiAoaSwgbm9kZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBMLmdldE5vZGVQb3NpdGlvbihub2RlLmlkKCkpXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIC8vIG1heWJlIHdlIGZpdCBlYWNoIGl0ZXJhdGlvblxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5maXQpIHtcclxuICAgICAgICAgICAgICAgIGN5LmZpdChvcHRpb25zLnBhZGRpbmcpO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBpZiAoZmlyc3RVcGRhdGUpIHtcclxuICAgICAgICAgICAgICAgIC8vIGluZGljYXRlIHRoZSBpbml0aWFsIHBvc2l0aW9ucyBoYXZlIGJlZW4gc2V0XHJcbiAgICAgICAgICAgICAgICBsYXlvdXQudHJpZ2dlcignbGF5b3V0cmVhZHknKTtcclxuICAgICAgICAgICAgICAgIGZpcnN0VXBkYXRlID0gZmFsc2U7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgZ3JhcGgub24oJ2NoYW5nZWQnLCBmdW5jdGlvbiAoZSkge1xyXG4gICAgICAgICAgLy8gIGNvbnNvbGUuZGlyKGUpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBfLmVhY2gobm9kZXMsIGZ1bmN0aW9uIChlLCBrKSB7XHJcbiAgICAgICAgICAgIGdyYXBoLmFkZE5vZGUoZS5pZClcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgXy5lYWNoKGVkZ2VzLCBmdW5jdGlvbiAoZSwgaykge1xyXG4gICAgICAgICAgICBpZighZWRnZXNIYXNoW2UuZGF0YSgpLnNvdXJjZSsnOicrZS5kYXRhKCkudGFyZ2V0XSAmJiAhZWRnZXNIYXNoW2UuZGF0YSgpLnRhcmdldCsnOicrZS5kYXRhKCkuc291cmNlXSl7XHJcbiAgICAgICAgICAgICAgICBlZGdlc0hhc2hbZS5kYXRhKCkuc291cmNlICsgJzonICsgZS5kYXRhKCkudGFyZ2V0XSA9IGU7XHJcbiAgICAgICAgICAgICAgICBncmFwaC5hZGRMaW5rKGUuZGF0YSgpLnNvdXJjZSwgZS5kYXRhKCkudGFyZ2V0KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB2YXIgTCA9IHRoYXQubChncmFwaCwgb3B0aW9ucyk7XHJcblxyXG4gICAgICAgIHZhciBsZWZ0ID0gb3B0aW9ucy5pdGVyYXRpb25zIDtcclxuXHJcbiAgICAgICAgTC5vbignc3RhYmxlJyxmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnZ290IFN0YWJsZSBldmVudCcpO1xyXG4gICAgICAgICAgICBsZWZ0ID0gb3B0aW9ucy5pdGVyYXRpb25zIDtcclxuICAgICAgICB9KTtcclxuICAgICAgICAvLyBmb3IgKHZhciBpID0gMDsgaSA8IChvcHRpb25zLml0ZXJhdGlvbnMgfHwgNTAwKTsgKytpKSB7XHJcblxyXG4gICAgICAgIGlmICghb3B0aW9ucy5hbmltYXRlKSB7XHJcbiAgICAgICAgICAgIG9wdGlvbnMucmVmcmVzaEludGVydmFsID0gMDtcclxuICAgICAgICB9XHJcbiAgICAgICAgdmFyIHVwZGF0ZVRpbWVvdXQ7XHJcblxyXG5cclxuICAgICAgICB2YXIgc3RlcCA9IGZ1bmN0aW9uICgpIHtcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuYW5pbWF0ZSkge1xyXG4gICAgICAgICAgICAgICAgaWYgKGxlZnQgIT0gMCAgLypjb25kaXRpb24gZm9yIHN0b3BwaW5nIGxheW91dCovKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCF1cGRhdGVUaW1lb3V0IHx8IGxlZnQgPT0gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1cGRhdGVUaW1lb3V0ID0gc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBMLnN0ZXAoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxlZnQtLTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVwZGF0ZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBkYXRlVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGVwKGxlZnQ9PTApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9LCBvcHRpb25zLnJlZnJlc2hJbnRlcnZhbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICBsYXlvdXQudHJpZ2dlcih7dHlwZTogJ2xheW91dHN0b3AnLCBsYXlvdXQ6IGxheW91dH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIGxheW91dC50cmlnZ2VyKHt0eXBlOiAnbGF5b3V0cmVhZHknLCBsYXlvdXQ6IGxheW91dH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9ZWxzZXtcclxuICAgICAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVmdDsgKytpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYoaT09TWF0aC5hYnMobGVmdC8yKSl7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdIYWxmIGRvbmUhJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIEwuc3RlcCh0cnVlKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHVwZGF0ZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgICAgICBzdGVwKCk7XHJcbiAgICAgICAgLy99XHJcblxyXG5cclxuICAgICAgICAvKiAgbm9kZXMubGF5b3V0UG9zaXRpb25zKGxheW91dCxvcHRpb25zLGZ1bmN0aW9uKGksZSl7XHJcbiAgICAgICAgIHJldHVybiBMLmdldE5vZGVQb3NpdGlvbihlLmRhdGEoKS5pZClcclxuICAgICAgICAgfSk7Ki9cclxuXHJcblxyXG4gICAgICAgIC8qICAgIF8uZWFjaChlZGdlcyxmdW5jdGlvbihlLGspe1xyXG4gICAgICAgICBncmFwaC5hZGRMaW5rKGUuZGF0YSgpLnNvdXJjZSwgZS5kYXRhKCkudGFyZ2V0KTtcclxuICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICBncmFwaC5mb3JFYWNoTm9kZShmdW5jdGlvbihub2RlKSB7XHJcbiAgICAgICAgIGVsZXMubm9kZXMoJyMnK25vZGUuaWQoKSB8fCBub2RlLmlkKS5wb3NpdGlvbihMLmdldE5vZGVQb3NpdGlvbihub2RlLmlkKSk7XHJcbiAgICAgICAgIH0pOyovXHJcblxyXG5cclxuICAgICAgICAvKiAgICAgICAgICB2YXIgZ2V0UmFuZG9tUG9zID0gZnVuY3Rpb24oIGksIGVsZSApe1xyXG4gICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICB4OiBNYXRoLnJvdW5kKCBNYXRoLnJhbmRvbSgpICogMTAwICksXHJcbiAgICAgICAgIHk6IE1hdGgucm91bmQoIE1hdGgucmFuZG9tKCkgKiAxMDAgKVxyXG4gICAgICAgICB9O1xyXG4gICAgICAgICB9OyovXHJcblxyXG4gICAgICAgIC8vIGRpY3JldGUvc3luY2hyb25vdXMgbGF5b3V0cyBjYW4ganVzdCB1c2UgdGhpcyBoZWxwZXIgYW5kIGFsbCB0aGVcclxuICAgICAgICAvLyBidXN5d29yayBpcyBoYW5kbGVkIGZvciB5b3UsIGluY2x1ZGluZyBzdGQgb3B0czpcclxuICAgICAgICAvLyAtIGZpdFxyXG4gICAgICAgIC8vIC0gcGFkZGluZ1xyXG4gICAgICAgIC8vIC0gYW5pbWF0ZVxyXG4gICAgICAgIC8vIC0gYW5pbWF0aW9uRHVyYXRpb25cclxuICAgICAgICAvLyAtIGFuaW1hdGlvbkVhc2luZ1xyXG4gICAgICAgIC8vIG5vZGVzLmxheW91dFBvc2l0aW9ucyggbGF5b3V0LCBvcHRpb25zLCBnZXRSYW5kb21Qb3MgKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHRoaXM7IC8vIG9yLi4uXHJcblxyXG4gICAgICAgIC8vIGNvbnRpbnVvdXMvYXN5bmNocm9ub3VzIGxheW91dHMgbmVlZCB0byBkbyB0aGluZ3MgbWFudWFsbHk6XHJcbiAgICAgICAgLy8gKHRoaXMgZXhhbXBsZSB1c2VzIGEgdGhyZWFkLCBidXQgeW91IGNvdWxkIHVzZSBhIGZhYnJpYyB0byBnZXQgZXZlblxyXG4gICAgICAgIC8vIGJldHRlciBwZXJmb3JtYW5jZSBpZiB5b3VyIGFsZ29yaXRobSBhbGxvd3MgZm9yIGl0KVxyXG5cclxuICAgICAgICAvKiAgICB2YXIgdGhyZWFkID0gdGhpcy50aHJlYWQgPSBjeXRvc2NhcGUudGhyZWFkKCk7XHJcbiAgICAgICAgIHRocmVhZC5yZXF1aXJlKCBnZXRSYW5kb21Qb3MsICdnZXRSYW5kb21Qb3MnICk7XHJcblxyXG4gICAgICAgICAvLyB0byBpbmRpY2F0ZSB3ZSd2ZSBzdGFydGVkXHJcbiAgICAgICAgIGxheW91dC50cmlnZ2VyKCdsYXlvdXRzdGFydCcpO1xyXG5cclxuICAgICAgICAgLy8gZm9yIHRocmVhZCB1cGRhdGVzXHJcbiAgICAgICAgIHZhciBmaXJzdFVwZGF0ZSA9IHRydWU7XHJcbiAgICAgICAgIHZhciBpZDJwb3MgPSB7fTtcclxuICAgICAgICAgdmFyIHVwZGF0ZVRpbWVvdXQ7XHJcblxyXG4gICAgICAgICAvLyB1cGRhdGUgbm9kZSBwb3NpdGlvbnNcclxuICAgICAgICAgdmFyIHVwZGF0ZSA9IGZ1bmN0aW9uKCl7XHJcbiAgICAgICAgIG5vZGVzLnBvc2l0aW9ucyhmdW5jdGlvbiggaSwgbm9kZSApe1xyXG4gICAgICAgICByZXR1cm4gaWQycG9zWyBub2RlLmlkKCkgXTtcclxuICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAvLyBtYXliZSB3ZSBmaXQgZWFjaCBpdGVyYXRpb25cclxuICAgICAgICAgaWYoIG9wdGlvbnMuZml0ICl7XHJcbiAgICAgICAgIGN5LmZpdCggb3B0aW9ucy5wYWRkaW5nICk7XHJcbiAgICAgICAgIH1cclxuXHJcbiAgICAgICAgIGlmKCBmaXJzdFVwZGF0ZSApe1xyXG4gICAgICAgICAvLyBpbmRpY2F0ZSB0aGUgaW5pdGlhbCBwb3NpdGlvbnMgaGF2ZSBiZWVuIHNldFxyXG4gICAgICAgICBsYXlvdXQudHJpZ2dlcignbGF5b3V0cmVhZHknKTtcclxuICAgICAgICAgZmlyc3RVcGRhdGUgPSBmYWxzZTtcclxuICAgICAgICAgfVxyXG4gICAgICAgICB9O1xyXG5cclxuICAgICAgICAgLy8gdXBkYXRlIHRoZSBub2RlIHBvc2l0aW9ucyB3aGVuIG5vdGlmaWVkIGZyb20gdGhlIHRocmVhZCBidXRcclxuICAgICAgICAgLy8gcmF0ZSBsaW1pdCBpdCBhIGJpdCAoZG9uJ3Qgd2FudCB0byBvdmVyd2hlbG0gdGhlIG1haW4vdWkgdGhyZWFkKVxyXG4gICAgICAgICB0aHJlYWQub24oJ21lc3NhZ2UnLCBmdW5jdGlvbiggZSApe1xyXG4gICAgICAgICB2YXIgbm9kZUpzb25zID0gZS5tZXNzYWdlO1xyXG4gICAgICAgICBub2RlSnNvbnMuZm9yRWFjaChmdW5jdGlvbiggbiApeyBpZDJwb3Nbbi5kYXRhLmlkXSA9IG4ucG9zaXRpb247IH0pO1xyXG5cclxuICAgICAgICAgaWYoICF1cGRhdGVUaW1lb3V0ICl7XHJcbiAgICAgICAgIHVwZGF0ZVRpbWVvdXQgPSBzZXRUaW1lb3V0KCBmdW5jdGlvbigpe1xyXG4gICAgICAgICB1cGRhdGUoKTtcclxuICAgICAgICAgdXBkYXRlVGltZW91dCA9IG51bGw7XHJcbiAgICAgICAgIH0sIG9wdGlvbnMucmVmcmVzaEludGVydmFsICk7XHJcbiAgICAgICAgIH1cclxuICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAvLyB3ZSB3YW50IHRvIGtlZXAgdGhlIGpzb24gc2VudCB0byB0aHJlYWRzIHNsaW0gYW5kIGZhc3RcclxuICAgICAgICAgdmFyIGVsZUFzSnNvbiA9IGZ1bmN0aW9uKCBlbGUgKXtcclxuICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgZGF0YToge1xyXG4gICAgICAgICBpZDogZWxlLmRhdGEoJ2lkJyksXHJcbiAgICAgICAgIHNvdXJjZTogZWxlLmRhdGEoJ3NvdXJjZScpLFxyXG4gICAgICAgICB0YXJnZXQ6IGVsZS5kYXRhKCd0YXJnZXQnKSxcclxuICAgICAgICAgcGFyZW50OiBlbGUuZGF0YSgncGFyZW50JylcclxuICAgICAgICAgfSxcclxuICAgICAgICAgZ3JvdXA6IGVsZS5ncm91cCgpLFxyXG4gICAgICAgICBwb3NpdGlvbjogZWxlLnBvc2l0aW9uKClcclxuXHJcbiAgICAgICAgIC8vIG1heWJlIGFkZCBjYWxjdWxhdGVkIGRhdGEgZm9yIHRoZSBsYXlvdXQsIGxpa2UgZWRnZSBsZW5ndGggb3Igbm9kZSBtYXNzXHJcbiAgICAgICAgIH07XHJcbiAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAvLyBkYXRhIHRvIHBhc3MgdG8gdGhyZWFkXHJcbiAgICAgICAgIHZhciBwYXNzID0ge1xyXG4gICAgICAgICBlbGVzOiBlbGVzLm1hcCggZWxlQXNKc29uICksXHJcbiAgICAgICAgIHJlZnJlc2hJdGVyYXRpb25zOiBvcHRpb25zLnJlZnJlc2hJdGVyYXRpb25zXHJcbiAgICAgICAgIC8vIG1heWJlIHNvbWUgbW9yZSBvcHRpb25zIHRoYXQgbWF0dGVyIHRvIHRoZSBjYWxjdWxhdGlvbnMgaGVyZSAuLi5cclxuICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgIC8vIHRoZW4gd2UgY2FsY3VsYXRlIGZvciBhIHdoaWxlIHRvIGdldCB0aGUgZmluYWwgcG9zaXRpb25zXHJcbiAgICAgICAgIHRocmVhZC5wYXNzKCBwYXNzICkucnVuKGZ1bmN0aW9uKCBwYXNzICl7XHJcbiAgICAgICAgIHZhciBnZXRSYW5kb21Qb3MgPSBfcmVmXygnZ2V0UmFuZG9tUG9zJyk7XHJcbiAgICAgICAgIHZhciBicm9hZGNhc3QgPSBfcmVmXygnYnJvYWRjYXN0Jyk7XHJcbiAgICAgICAgIHZhciBub2RlSnNvbnMgPSBwYXNzLmVsZXMuZmlsdGVyKGZ1bmN0aW9uKGUpeyByZXR1cm4gZS5ncm91cCA9PT0gJ25vZGVzJzsgfSk7XHJcblxyXG4gICAgICAgICAvLyBjYWxjdWxhdGUgZm9yIGEgd2hpbGUgKHlvdSBtaWdodCB1c2UgdGhlIGVkZ2VzIGhlcmUpXHJcbiAgICAgICAgIGZvciggdmFyIGkgPSAwOyBpIDwgMTAwMDAwOyBpKysgKXtcclxuICAgICAgICAgbm9kZUpzb25zLmZvckVhY2goZnVuY3Rpb24oIG5vZGVKc29uLCBqICl7XHJcbiAgICAgICAgIG5vZGVKc29uLnBvc2l0aW9uID0gZ2V0UmFuZG9tUG9zKCBqLCBub2RlSnNvbiApO1xyXG4gICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgIGlmKCBpICUgcGFzcy5yZWZyZXNoSXRlcmF0aW9ucyA9PT0gMCApeyAvLyBjaGVhcGVyIHRvIG5vdCBicm9hZGNhc3QgYWxsIHRoZSB0aW1lXHJcbiAgICAgICAgIGJyb2FkY2FzdCggbm9kZUpzb25zICk7IC8vIHNlbmQgbmV3IHBvc2l0aW9ucyBvdXRzaWRlIHRoZSB0aHJlYWRcclxuICAgICAgICAgfVxyXG4gICAgICAgICB9XHJcbiAgICAgICAgIH0pLnRoZW4oZnVuY3Rpb24oKXtcclxuICAgICAgICAgLy8gdG8gaW5kaWNhdGUgd2UndmUgZmluaXNoZWRcclxuICAgICAgICAgbGF5b3V0LnRyaWdnZXIoJ2xheW91dHN0b3AnKTtcclxuICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICByZXR1cm4gdGhpczsgLy8gY2hhaW5pbmcqL1xyXG4gICAgfTtcclxuXHJcbiAgICBMYXlvdXQucHJvdG90eXBlLnN0b3AgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgLy8gY29udGludW91cy9hc3luY2hyb25vdXMgbGF5b3V0IG1heSB3YW50IHRvIHNldCBhIGZsYWcgZXRjIHRvIGxldFxyXG4gICAgICAgIC8vIHJ1bigpIGtub3cgdG8gc3RvcFxyXG5cclxuICAgICAgICBpZiAodGhpcy50aHJlYWQpIHtcclxuICAgICAgICAgICAgdGhpcy50aHJlYWQuc3RvcCgpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy50cmlnZ2VyKCdsYXlvdXRzdG9wJyk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzOyAvLyBjaGFpbmluZ1xyXG4gICAgfTtcclxuXHJcbiAgICBMYXlvdXQucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgLy8gY2xlYW4gdXAgaGVyZSBpZiB5b3UgY3JlYXRlIHRocmVhZHMgZXRjXHJcblxyXG4gICAgICAgIGlmICh0aGlzLnRocmVhZCkge1xyXG4gICAgICAgICAgICB0aGlzLnRocmVhZC5zdG9wKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gdGhpczsgLy8gY2hhaW5pbmdcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIExheW91dDtcclxuXHJcbn07XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGdldChjeXRvc2NhcGUpIHtcclxuICAgIFRocmVhZCA9IGN5dG9zY2FwZS5UaHJlYWQ7XHJcblxyXG4gICAgcmV0dXJuIG5ncmFwaChjeXRvc2NhcGUpO1xyXG59O1xyXG4iLCIndXNlIHN0cmljdCc7XHJcblxyXG4oZnVuY3Rpb24oKXtcclxuXHJcbiAgICAvLyByZWdpc3RlcnMgdGhlIGV4dGVuc2lvbiBvbiBhIGN5dG9zY2FwZSBsaWIgcmVmXHJcbiAgICB2YXIgZ2V0TGF5b3V0ID0gcmVxdWlyZSgnLi9pbXBsLmpzJyk7XHJcbiAgICB2YXIgcmVnaXN0ZXIgPSBmdW5jdGlvbiggY3l0b3NjYXBlICl7XHJcbiAgICAgICAgdmFyIExheW91dCA9IGdldExheW91dCggY3l0b3NjYXBlICk7XHJcblxyXG4gICAgICAgIGN5dG9zY2FwZSgnbGF5b3V0JywgJ2N5dG9zY2FwZS1uZ3JhcGguZm9yY2VsYXlvdXQnLCBMYXlvdXQpO1xyXG4gICAgfTtcclxuXHJcbiAgICBpZiggdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcgJiYgbW9kdWxlLmV4cG9ydHMgKXsgLy8gZXhwb3NlIGFzIGEgY29tbW9uanMgbW9kdWxlXHJcbiAgICAgICAgbW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlcjtcclxuICAgIH1cclxuXHJcbiAgICBpZiggdHlwZW9mIGRlZmluZSAhPT0gJ3VuZGVmaW5lZCcgJiYgZGVmaW5lLmFtZCApeyAvLyBleHBvc2UgYXMgYW4gYW1kL3JlcXVpcmVqcyBtb2R1bGVcclxuICAgICAgICBkZWZpbmUoJ2N5dG9zY2FwZS1uZ3JhcGguZm9yY2VsYXlvdXQnLCBmdW5jdGlvbigpe1xyXG4gICAgICAgICAgICByZXR1cm4gcmVnaXN0ZXI7XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYoIHR5cGVvZiBjeXRvc2NhcGUgIT09ICd1bmRlZmluZWQnICl7IC8vIGV4cG9zZSB0byBnbG9iYWwgY3l0b3NjYXBlIChpLmUuIHdpbmRvdy5jeXRvc2NhcGUpXHJcbiAgICAgICAgcmVnaXN0ZXIoIGN5dG9zY2FwZSApO1xyXG4gICAgfVxyXG5cclxufSkoKTsiXX0=
