import StyleLayer from '../style_layer';

import CircleBucket from '../../data/bucket/circle_bucket';
import {polygonIntersectsBufferedPoint} from '../../util/intersection_tests';
import {getMaximumPaintValue, translateDistance, translate} from '../query_utils';
import properties, {CircleLayoutPropsPossiblyEvaluated, CirclePaintPropsPossiblyEvaluated} from './circle_style_layer_properties.g';
import {Transitionable, Transitioning, Layout, PossiblyEvaluated} from '../properties';
import {mat4, vec4} from 'gl-matrix';
import Point from '@mapbox/point-geometry';
import type {FeatureState} from '../../style-spec/expression';
import type Transform from '../../geo/transform';
import type {Bucket, BucketParameters} from '../../data/bucket';
import type {CircleLayoutProps, CirclePaintProps} from './circle_style_layer_properties.g';
import type {LayerSpecification} from '../../style-spec/types.g';
import type {VectorTileFeature} from '@mapbox/vector-tile';

class CircleStyleLayer extends StyleLayer {
    _unevaluatedLayout: Layout<CircleLayoutProps>;
    layout: PossiblyEvaluated<CircleLayoutProps, CircleLayoutPropsPossiblyEvaluated>;

    _transitionablePaint: Transitionable<CirclePaintProps>;
    _transitioningPaint: Transitioning<CirclePaintProps>;
    paint: PossiblyEvaluated<CirclePaintProps, CirclePaintPropsPossiblyEvaluated>;

    constructor(layer: LayerSpecification) {
        super(layer, properties);
    }

    createBucket(parameters: BucketParameters<any>) {
        return new CircleBucket(parameters);
    }

    queryRadius(bucket: Bucket): number {
        const circleBucket: CircleBucket<CircleStyleLayer> = (bucket as any);
        return getMaximumPaintValue('circle-radius', this, circleBucket) +
            getMaximumPaintValue('circle-stroke-width', this, circleBucket) +
            translateDistance(this.paint.get('circle-translate'));
    }

    queryIntersectsFeature(
        queryGeometry: Array<Point>,
        feature: VectorTileFeature,
        featureState: FeatureState,
        geometry: Array<Array<Point>>,
        zoom: number,
        transform: Transform,
        pixelsToTileUnits: number,
        pixelPosMatrix: mat4
    ): boolean {
        const translatedPolygon = translate(queryGeometry,
            this.paint.get('circle-translate'),
            this.paint.get('circle-translate-anchor'),
            transform.angle, pixelsToTileUnits);
        const radius = this.paint.get('circle-radius').evaluate(feature, featureState);
        const stroke = this.paint.get('circle-stroke-width').evaluate(feature, featureState);
        const size  = radius + stroke;

        // For pitch-alignment: map, compare feature geometry to query geometry in the plane of the tile
        // // Otherwise, compare geometry in the plane of the viewport
        // // A circle with fixed scaling relative to the viewport gets larger in tile space as it moves into the distance
        // // A circle with fixed scaling relative to the map gets smaller in viewport space as it moves into the distance
        const alignWithMap = this.paint.get('circle-pitch-alignment') === 'map';
        const transformedPolygon = alignWithMap ? translatedPolygon : projectQueryGeometry(translatedPolygon, pixelPosMatrix);
        const transformedSize = alignWithMap ? size * pixelsToTileUnits : size;

        for (const ring of geometry) {
            for (const point of ring) {

                const transformedPoint = alignWithMap ? point : projectPoint(point, pixelPosMatrix);

                let adjustedSize = transformedSize;
                const projectedCenter = vec4.transformMat4(vec4.create(), [point.x, point.y, 0, 1], pixelPosMatrix);
                if (this.paint.get('circle-pitch-scale') === 'viewport' && this.paint.get('circle-pitch-alignment') === 'map') {
                    adjustedSize *= projectedCenter[3] / transform.cameraToCenterDistance;
                } else if (this.paint.get('circle-pitch-scale') === 'map' && this.paint.get('circle-pitch-alignment') === 'viewport') {
                    adjustedSize *= transform.cameraToCenterDistance / projectedCenter[3];
                }

                if (polygonIntersectsBufferedPoint(transformedPolygon, transformedPoint, adjustedSize)) return true;
            }
        }

        return false;
    }
}

function projectPoint(p: Point, pixelPosMatrix: mat4) {
    const point = vec4.transformMat4(vec4.create(), [p.x, p.y, 0, 1], pixelPosMatrix);
    return new Point(point[0] / point[3], point[1] / point[3]);
}

function projectQueryGeometry(queryGeometry: Array<Point>, pixelPosMatrix: mat4) {
    return queryGeometry.map((p) => {
        return projectPoint(p, pixelPosMatrix);
    });
}

export default CircleStyleLayer;
