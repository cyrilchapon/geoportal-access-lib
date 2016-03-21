/**
 * Factory pour générer une reponse JSON à partir d'un XML ou d'un JSON
 * (Factory)
 *
 * @module RouteResponseFactory
 * @alias Gp.Services.Route.Response.RouteResponseFactory
 * @private
 */
define([
    "Utils/LoggerByDefault",
    "Exceptions/ErrorService",
    "Formats/XML",
    "Formats/WKT",
    "Utils/MessagesResources",
    "Services/Route/Formats/RouteResponseRESTReader",
    "Services/Route/Formats/RouteResponseOLSReader",
    "Services/Route/Response/model/RouteResponse",
    "Services/Route/Response/model/RouteInstruction"
],
function (
    Logger,
    ErrorService,
    XML, WKT, MRes, RouteResponseRESTReader, RouteResponseOLSReader,
    RouteResponse, RouteInstruction
) {

    "use strict";

    var RouteResponseFactory = {

        /**
         * interface unique
         *
         * @method build
         * @static
         * @param {Object} options - options definies dans le composant Alti
         *
         * @example
         *   var options = {
         *      response :
         *      outputFormat :
         *      rawResponse :
         *      scope :
         *      onSuccess :
         *      onError :
         *   };
         *
         */
        build : function (options) {

            // logger
            var logger = Logger.getLogger("RouteResponseFactory");
            logger.trace("RouteResponseFactory::build()");

            var data = null;

            if ( options.response ) {
                if ( options.rawResponse ) {
                    logger.trace("analyze response : raw");
                    data = options.response;
                } else {
                    switch (options.outputFormat) {

                        case "xml" :
                            logger.trace("analyze response : xml");

                            // type de reader en fonction de l'API
                            var routeReader = options.api === "REST" ? RouteResponseRESTReader : RouteResponseOLSReader;

                            try {

                                var p = new XML({
                                    reader : routeReader
                                });

                                // FIXME : mode XHR ne retourne que des string ? JSONP aussi à ce niveau ?
                                if ( typeof options.response === "string" ) {
                                    p.setXMLString(options.response);
                                } else {
                                    p.setXMLDoc(options.response);
                                }

                                data = p.parse();

                                if (! data) {
                                    throw new ErrorService(MRes.getMessage("SERVICE_RESPONSE_FORMAT", "xml"));
                                }

                            } catch (e) {
                                options.onError.call(options.scope, new ErrorService(MRes.getMessage("SERVICE_RESPONSE_ANALYSE", options.response)));
                                return;
                            }

                            break;

                        case "json":
                            logger.trace("analyze response : json");

                            var JSONResponse;
                            if ( typeof options.response === "string" ) {
                                // FIXME : tester l'environnement (nodejs ou browser ?)
                                JSONResponse = window.JSON.parse(options.response);
                            } else {
                                JSONResponse = options.response;
                            }

                            // le service renvoie t il une erreur ?
                            if (JSONResponse.message) {
                                // ex. {"message":"message not null", "status":"ERROR"}
                                options.onError.call(options.scope, new ErrorService(MRes.getMessage("SERVICE_RESPONSE_EXCEPTION", JSONResponse.message)));
                                return;
                            }

                            // construction de l'objet réponse JSON
                            if ( JSONResponse ) {
                                var legs = [];
                                var legSteps = [];
                                var steps = [];

                                data = new RouteResponse();

                                if ( data.hasOwnProperty("totalTime")) {
                                    // info: il y a aussi JSONResponse.duration, qui donne la durée en hh:mm:ss.
                                    data.totalTime = parseFloat(JSONResponse.durationSeconds);
                                }
                                if ( data.hasOwnProperty("totalDistance")) {
                                    data.totalDistance = JSONResponse.distance;
                                }

                                if ( data.hasOwnProperty("bbox")) {
                                    var coords = JSONResponse.bounds.split(/[,;]/);
                                    data.bbox.left = parseFloat(coords[0]);
                                    data.bbox.bottom = parseFloat(coords[1]);
                                    data.bbox.right = parseFloat(coords[2]);
                                    data.bbox.top = parseFloat(coords[3]);
                                }
                                /** callback success */
                                var onWKTSuccess = function (json) {
                                    data.routeGeometry = json;
                                };
                                /** callback failed */
                                var onWKTError = function (e) {
                                    console.log(e);
                                    options.onError.call(options.scope, new ErrorService(MRes.getMessage("PARAM_FORMAT", ["geometryWkt"])));
                                };

                                if ( data.hasOwnProperty("routeGeometry")) {
                                    WKT.toJson(JSONResponse.geometryWkt, onWKTSuccess, onWKTError);
                                    if (!data.routeGeometry) {
                                        return;
                                    }
                                }

                                if ( data.hasOwnProperty("routeInstructions")) {
                                    var legList = JSONResponse.legs;
                                    var i;
                                    if ( Array.isArray(legList) && legList.length ) {
                                        for (i = 0; i < legList.length; i++) {
                                            legs.push(legList[i]);
                                        }
                                    }
                                    if ( Array.isArray(legs) && legs.length ) {
                                        for (i = 0; i < legs.length; i++) {
                                            legSteps.push(legs[i].steps);
                                        }
                                    }
                                    if ( Array.isArray(legSteps) && legSteps.length ) {
                                        for (i = 0; i < legSteps.length; i++) {
                                            steps = steps.concat(legSteps[i]);
                                        }
                                    }

                                    steps.forEach( function (step) {
                                        data.routeInstructions.push(new RouteInstruction());
                                        data.routeInstructions[data.routeInstructions.length - 1].duration = step.duration;
                                        data.routeInstructions[data.routeInstructions.length - 1].distance = step.distance;
                                        data.routeInstructions[data.routeInstructions.length - 1].code = step.navInstruction;
                                        /*
                                        Traduction du code en instruction
                                        * - F : tout droit
                                        * - B : demi-tour
                                        * - L : tourner à gauche
                                        * - R : tourner à droite
                                        * - BL : tourner très à gauche
                                        * - BR : tourner très à droite
                                        * - FL : tourner légèrement à gauche
                                        * - FR : tourner légèrement à droite
                                        * - round_about_entry : entrée rond-point
                                        * - round_about_exit : sortie rond-point
                                        */
                                        switch (step.navInstruction) {
                                            case "F" :
                                                if (step.name != "Valeur non renseignée") {
                                                    data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tout droit " + step.name;
                                                } else {
                                                    data.routeInstructions[data.routeInstructions.length - 1].instruction = "Continuer tout droit ";
                                                }
                                                break;
                                            case "B" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Demi-tour " + step.name;
                                                break;
                                            case "L" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tourner à gauche " + step.name;
                                                break;
                                            case "R" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tourner à droite " + step.name;
                                                break;
                                            case "BL" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tourner très à gauche " + step.name;
                                                break;
                                            case "BR" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tourner très à droite " + step.name;
                                                break;
                                            case "FL" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tourner légèrement à gauche " + step.name;
                                                break;
                                            case "FR" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Tourner légèrement à droite " + step.name;
                                                break;
                                            case "round_about_entry" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Entrée rond-point " + step.name;
                                                break;
                                            case "round_about_exit" :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Sortie rond-point " + step.name;
                                                break;
                                            case null :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "Prendre " + step.name;
                                                break;
                                            default :
                                                data.routeInstructions[data.routeInstructions.length - 1].instruction = "?" + step.navInstruction + "? " + step.name;
                                                break;
                                        }
                                    });
                                }
                            }

                            if (! data) {
                                options.onError.call(options.scope, new ErrorService(MRes.getMessage("SERVICE_RESPONSE_ANALYSE", "json")));
                                return;
                            }
                            break;

                        default :
                            options.onError.call(options.scope, new ErrorService(MRes.getMessage("SERVICE_RESPONSE_FORMAT", "json", "xml")));
                            return;
                    }

                    // Si la réponse contenait une exception renvoyée par le service
                    if ( data && data.exceptionReport ) {
                        options.onError.call(options.scope, new ErrorService(MRes.getMessage("SERVICE_RESPONSE_EXCEPTION_2")));
                        return;
                    }
                }
            } else {
                options.onError.call(options.scope, new ErrorService(MRes.getMessage("SERVICE_RESPONSE_EMPTY")));
                return;
            }

            options.onSuccess.call(options.scope, data);
            return;
        }
    };

    return RouteResponseFactory;
});