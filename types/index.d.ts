/// <reference lib="dom"/>
/// <reference types="cypress"/>
import { SnapshotOptions } from '@percy/core';
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Padding {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}

export interface ElementSelector {
  boundingBox?: BoundingBox;
  elementXpath?: string;
  elementCSS?: string;
}

export interface RegionConfiguration {
  diffSensitivity?: number;
  imageIgnoreThreshold?: number;
  carouselsEnabled?: boolean;
  bannersEnabled?: boolean;
  adsEnabled?: boolean;
}

export interface RegionAssertion {
  diffIgnoreThreshold?: number;
}

export interface Region {
  algorithm: string;
  elementSelector: ElementSelector;
  padding?: Padding;
  configuration?: RegionConfiguration;
  assertion?: RegionAssertion;
}

export interface CreateRegionOptions {
  boundingBox?: BoundingBox;
  elementXpath?: string;
  elementCSS?: string;
  padding?: Padding;
  algorithm?: string;
  diffSensitivity?: number;
  imageIgnoreThreshold?: number;
  carouselsEnabled?: boolean;
  bannersEnabled?: boolean;
  adsEnabled?: boolean;
  diffIgnoreThreshold?: number;
}

export function createRegion(options: CreateRegionOptions): Region;

export interface PercySnapshotOptions extends SnapshotOptions {
  regions?: Region[];
}

declare global {
  namespace Cypress {
    interface Chainable<Subject> {
      percySnapshot(
        name?: string,
        options?: PercySnapshotOptions
      ): Chainable<Subject>
    }
  }
}
