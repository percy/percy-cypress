/// <reference lib="dom"/>
/// <reference types="cypress"/>
import { SnapshotOptions } from '@percy/core';

// Extended snapshot options for percy-cypress
export interface PercyCypressSnapshotOptions extends SnapshotOptions {
  // Custom CSS injection
  percyCSS?: string;
  
  // Minimum height for snapshot
  minHeight?: number;
  
  // Synchronous result
  sync?: boolean;
  
  // Regions array for ignore/consider regions
  regions?: Array<{
    elementSelector?: {
      boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      elementXpath?: string;
      elementCSS?: string;
    };
    algorithm: 'ignore' | 'standard' | 'intelliignore' | 'layout';
    padding?: number | {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
    configuration?: {
      diffSensitivity?: number;
      imageIgnoreThreshold?: number;
      carouselsEnabled?: boolean;
      bannersEnabled?: boolean;
      adsEnabled?: boolean;
    };
    assertion?: {
      diffIgnoreThreshold?: number;
    };
  }>;
}

// createRegion helper function
export interface CreateRegionOptions {
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  elementXpath?: string;
  elementCSS?: string;
  padding?: number | {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  algorithm?: 'ignore' | 'standard' | 'intelliignore' | 'layout';
  diffSensitivity?: number;
  imageIgnoreThreshold?: number;
  carouselsEnabled?: boolean;
  bannersEnabled?: boolean;
  adsEnabled?: boolean;
  diffIgnoreThreshold?: number;
}

export function createRegion(options?: CreateRegionOptions): {
  elementSelector: {
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    elementXpath?: string;
    elementCSS?: string;
  };
  algorithm: string;
  padding?: number | {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  configuration?: {
    diffSensitivity?: number;
    imageIgnoreThreshold?: number;
    carouselsEnabled?: boolean;
    bannersEnabled?: boolean;
    adsEnabled?: boolean;
  };
  assertion?: {
    diffIgnoreThreshold?: number;
  };
};

// SDK info exports
export const CLIENT_INFO: string;
export const ENV_INFO: string;

declare global {
  namespace Cypress {
    interface Chainable<Subject> {
      percySnapshot(
        name?: string,
        options?: PercyCypressSnapshotOptions
      ): Chainable<Subject>
    }
  }
}
