import{geoArea}from'd3-geo';
import type{Position}from'geojson';
import type{RegionalGeometry}from'./RegionalMap';
/** d3's spherical polygon winding is opposite RFC 7946; normalize a render-only copy. */
function rings(coordinates:Position[][]){return geoArea({type:'Polygon',coordinates})>2*Math.PI?coordinates.map(r=>[...r].reverse()):coordinates;}
export function projectionGeometry(input:RegionalGeometry):RegionalGeometry{return {...input,features:input.features.map(feature=>({...feature,geometry:feature.geometry.type==='Polygon'?{...feature.geometry,coordinates:rings(feature.geometry.coordinates)}:feature.geometry.type==='MultiPolygon'?{...feature.geometry,coordinates:feature.geometry.coordinates.map(rings)}:feature.geometry}))};}
