 'use strict';

 var  Graph = require('ngraph.graph');
 var  _ = require('underscore');
 var Nlayout = require('ngraph.forcelayout');
 var Thread;
    // registers the extension on a cytoscape lib ref
    var ngraph = function( cytoscape ){

        if( !cytoscape ){ return; } // can't register if cytoscape unspecified

        var defaults = {
            springLength: 30,
            springCoeff: 0.0008,
            gravity: -1.2,
            theta: 0.8,
            dragCoeff: 0.02,
            timeStep: 20,
            refreshInterval: 16, // in ms
            refreshIterations: 10, // iterations until thread sends an update
            fit: true
        };

        var extend = Object.assign || function( tgt ){
                for( var i = 1; i < arguments.length; i++ ){
                    var obj = arguments[i];

                    for( var k in obj ){ tgt[k] = obj[k]; }
                }

                return tgt;
            };

        function Layout( options ){
            this.options = extend( {}, defaults, options );
        }

        Layout.prototype.l = Nlayout;
        Layout.prototype.g = Graph;

        Layout.prototype.run = function(){
            var ITERATIONS_COUNT = 200;
            var layout = this;
            var options = this.options;
            var that = this;
            var graph = that.g();
            var cy = options.cy;
            var eles = options.eles;
            var nodes = eles.nodes();
            var edges = eles.edges();
            _.each(nodes,function(e,k){
                graph.addNode(e.id)
            });

            _.each(edges,function(e,k){
                graph.addLink(e.data().source, e.data().target);
            });

            var L = that.l(graph,options);

            for (var i = 0; i < options.iterations; ++i) {
                L.step();
            }

            nodes.layoutPositions(layout,options,function(i,e){
                return L.getNodePosition(e.data().id)
            });

        /*    _.each(edges,function(e,k){
                graph.addLink(e.data().source, e.data().target);
            });

            graph.forEachNode(function(node) {
                eles.nodes('#'+node.id() || node.id).position(L.getNodePosition(node.id));
            });*/


            var getRandomPos = function( i, ele ){
                return {
                    x: Math.round( Math.random() * 100 ),
                    y: Math.round( Math.random() * 100 )
                };
            };

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

            var thread = this.thread = cytoscape.thread();
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

            return this; // chaining
        };

        Layout.prototype.stop = function(){
            // continuous/asynchronous layout may want to set a flag etc to let
            // run() know to stop

            if( this.thread ){
                this.thread.stop();
            }

            this.trigger('layoutstop');

            return this; // chaining
        };

        Layout.prototype.destroy = function(){
            // clean up here if you create threads etc

            if( this.thread ){
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
