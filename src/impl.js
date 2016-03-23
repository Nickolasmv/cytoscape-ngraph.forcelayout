'use strict';

var Graph = require('ngraph.graph');
var _ = require('underscore');
var Q = require('Q');
//var Nlayout = require('ngraph.forcelayout.v2');
var Nlayout = require('ngraph.asyncforce');
var Thread;
// registers the extension on a cytoscape lib ref
var ngraph = function (cytoscape) {

        if (!cytoscape) {
            return;
        } // can't register if cytoscape unspecified

        var defaults = {
            async: {
                // tell layout that we want to compute all at once:
                maxIterations: 1000,
                stepsPerCycle: 30,

                // Run it till the end:
                waitForStep: false
            },
            physics :{
            /**
             * Ideal length for links (springs in physical model).
             */
            springLength: 100,

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
            iterations: 10000,
            fit: true,

            /**
             * Maximum movement of the system which can be considered as stabilized
             */
            stableThreshold: 0.000009
            /*springLength: 100,
            springCoeff: 0.00008,
            gravity: -1,
            theta: 0.001,
            animate: true,
            dragCoeff: 0.01,
            timeStep: 90,
            stableThreshold: 2,
            iterations: 10000,
            refreshInterval: 16, // in ms
            refreshIterations: 10, // iterations until thread sends an update
            fit: true*/
        },
            iterations: 10000,
            refreshInterval: 16, // in ms
            refreshIterations: 10, // iterations until thread sends an update
            stableThreshold: 2,
            animate: true,
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
            this.layoutOptions = extend({}, defaults, options);
            delete  this.layoutOptions.cy;
            delete  this.layoutOptions.eles;
        }

        Layout.prototype.l = Nlayout;
        Layout.prototype.g = Graph;

        Layout.prototype.run = function () {
            var layout = this;
            layout.trigger({type: 'layoutstart', layout: layout});
            var options = this.options;
            var layoutOptions = this.layoutOptions;
            var that = this;
            var graph = that.g();
            var cy = options.cy;
            var eles = options.eles;
            var nodes = eles.nodes();
            var parents = nodes.parents();

            // FILTER

            nodes = nodes.difference(parents);

            nodes = nodes.filterFn(function( ele ){
                return ele.connectedEdges().length>0
            });

            var edges = eles.edges();
            var edgesHash = {};
            var L;


            var firstUpdate = true;

            /*        if (eles.length > 3000) {
             options.iterations = options.iterations - Math.abs(options.iterations / 3); // reduce iterations for big graph
             }*/

            var update = function (nodesJson) {
                /* cy.batch(function () {
                 nodesJson.forEach(function(e,k){
                 nodes.$('#'+ e.data.id).position(e.position);
                 })

                 });*/
                nodes.positions(function (i, node) {
                    if(!node.data('dragging'))
                    return L.getNodePosition(node.id())
                });

                if(layoutOptions.async){
                    layout.trigger({type: 'layoutstop', layout: layout});
                    layout.trigger({type: 'layoutready', layout: layout});
                }

               /* nodes.forEach(function (node) {
                    L.getNodePosition(node.id())
                });*/

                // maybe we fit each iteration
                if (layoutOptions.fit) {
                    cy.fit(layoutOptions.padding);
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
                e.on('tapstart',function(e){
                 e.cyTarget.data('dragging',true)
                });  e.on('tapend',function(e){
                    e.cyTarget.removeData('dragging');
                });  e.on('position','node[dragging]',function(e){
                   if(L.setNodePosition && e.cyTarget.data('dragging')) {
                       L.setNodePosition(e.cyTarget.data().id);
                   }
                });
                graph.addNode(e.data().id);
            });

            _.each(edges, function (e, k) {
                if (!edgesHash[e.data().source + ':' + e.data().target] && !edgesHash[e.data().target + ':' + e.data().source]) {
                    edgesHash[e.data().source + ':' + e.data().target] = e;
                    graph.addLink(e.data().source, e.data().target);
                }
            });

          L = that.l(graph, layoutOptions);

            _.each(nodes, function (e, k) {
                var data = e.data();
                //var pos = e.position();
                if (data.pin) {
                    L.pinNode(data.id, true);
                    e.removeData('pin');
                    e.data('unpin',true);
                } else if(data.unpin) {
                    L.pinNode(data.id, false);
                    e.removeData('unpin');
                }
                //if (pos.x && pos.y) {
                //  L.setNodePosition(data.id, pos);
                //}
            });

            var left = layoutOptions.iterations;

                this.on('layoutstop',function(){
                    layoutOptions.iterations = 0;
                });

            L.on('stable', function () {
                console.log('got Stable event');
                left = layoutOptions.iterations;
            });


            var left = layoutOptions.iterations;

            L.on('stable', function () {
                console.log('got Stable event');
                left = 0;
            });
            // for (var i = 0; i < (options.iterations || 500); ++i) {

            if (!layoutOptions.animate) {
                layoutOptions.refreshInterval = 0;
            }
            var updateTimeout;
            L.on('cycle', function() {
                update();
            });

            if(layoutOptions.async){
                return this;
            }

            var step = function () {
                if (layoutOptions.animate) {
                    if (left != 0  /*condition for stopping layout*/) {
                        if (!updateTimeout || left == 0) {
                            updateTimeout = setTimeout(function () {
                                left--;
                                //update();
                                updateTimeout = null;
                                L.step() ?  left =0:false;
                               // update();
                                step();
                                //step();
                            }, layoutOptions.refreshInterval);
                        }
                    } else {
                        layout.trigger({type: 'layoutstop', layout: layout});
                        layout.trigger({type: 'layoutready', layout: layout});
                    }
                } else {

                    for (var i = 0; i < layoutOptions.iterations; i++) {
                        L.step()
                    }
                    layout.trigger({type: 'layoutstop', layout: layout});
                    layout.trigger({type: 'layoutready', layout: layout});
                    //update();
                }

            };
            step();

            function calcAndSend() {
                update();
                /* nodeJsons.forEach(function( nodeJson, j ){
                 nodeJson.position = L.getNodePosition(node.data.id)
                 });
                 broadcast( nodeJsons );*/
            }


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

            /*      var thread = this.thread = cytoscape.thread();
             thread.require(L);

             // to indicate we've started
             layout.trigger('layoutstart');

             // for thread updates
             // var firstUpdate = true;
             // var id2pos = {};
             // var updateTimeout;

             // update node positions
             /!*   var update = function(){
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
             };*!/

             // update the node positions when notified from the thread but
             // rate limit it a bit (don't want to overwhelm the main/ui thread)
             thread.on('message', function( e ){
             var nodeJsons = e.message;
             update(nodeJsons);
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
             refreshInterval:  options.refreshInterval
             // maybe some more options that matter to the calculations here ...
             };

             // then we calculate for a while to get the final positions
             thread.pass( pass ).run(function( pass ){;
             var broadcast = _ref_('broadcast');
             var nodeJsons = pass.eles.filter(function(e){ return e.group === 'nodes'; });



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
             if (left != 0  /!*condition for stopping layout*!/) {
             if (!updateTimeout || left == 0) {
             updateTimeout = setTimeout(function () {
             left--;
             L.step(left==0);
             calcAndSend(  );
             //update();
             updateTimeout = null;
             step();
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
             calcAndSend();
             L.step(true);
             }
             update();
             }
             };
             step();

             function calcAndSend(){
             nodeJsons.forEach(function( nodeJson, j ){
             nodeJson.position = L.getNodePosition(node.data.id)
             });
             broadcast( nodeJsons );
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

    }
    ;

module.exports = function get(cytoscape) {
    Thread = cytoscape.Thread;

    return ngraph(cytoscape);
};
