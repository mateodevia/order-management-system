import { AppError } from '@oms/shared/util-errors';

/** WGS84 latitude/longitude pair returned by geocoding. */
export interface Coordinates {
  lat: number;
  lng: number;
}

/** Known mock addresses resolvable by {@link GeocodingClient}. */
export enum GeocodingMockedAddress {
  Atlanta = '191 Peachtree St NE, Atlanta, GA',
  Chicago = 'Millennium Park, Chicago, IL',
  Dallas = '2100 Ross Ave, Dallas, TX',
  Denver = '1701 Wynkoop St, Denver, CO',
  Phoenix = '400 E Van Buren St, Phoenix, AZ',
}

const ADDRESS_COORDINATES: Record<string, Coordinates> = {
  [GeocodingMockedAddress.Atlanta]: { lat: 33.7578, lng: -84.3876 },
  [GeocodingMockedAddress.Chicago]: { lat: 41.8826, lng: -87.6227 },
  [GeocodingMockedAddress.Dallas]: { lat: 32.7875, lng: -96.7963 },
  [GeocodingMockedAddress.Denver]: { lat: 39.7532, lng: -105.0001 },
  [GeocodingMockedAddress.Phoenix]: { lat: 33.4504, lng: -112.0675 },
};

/**
 * Contract for geocoding clients.
 *
 * Production code must depend on this interface, not the concrete {@link GeocodingClient}
 * class. This keeps the swap from mock → real geocoding API a configuration change, not
 * a refactor, and prevents test-only helpers from leaking into production call-sites.
 */
export interface IGeocodingClient {
  /**
   * Resolves a free-text shipping address to a geographic coordinate pair.
   *
   * @param address - Shipping address string from the order payload.
   */
  geocode(address: string): Promise<Coordinates>;
}

/**
 * Mock geocoding client for development and tests.
 *
 * Resolves known warehouse and shipping addresses to fixed coordinates.
 *
 * @remarks Implements {@link IGeocodingClient}. The `testables` property is intentionally
 * absent from the interface so production code typed against `IGeocodingClient` cannot
 * reach test-only controls.
 */
export class GeocodingClient implements IGeocodingClient {
  /** When set, the next {@link GeocodingClient.geocode} call throws this error. */
  private forcedError: Error | null = null;

  /**
   * Test-only controls for simulating geocoding behavior on this client instance.
   *
   * @remarks Do not call from production code. This property does not appear on
   * {@link IGeocodingClient}, so it is unreachable from any call-site that depends
   * on the interface rather than the concrete class.
   */
  readonly testables = {
    /**
     * Forces subsequent {@link GeocodingClient.geocode} calls to fail with the given error.
     *
     * @param error - Error to throw; defaults to a 503 service-unavailable {@link AppError}.
     */
    forceFailure: (error: Error = new AppError(503, 'Geocoding service unavailable')): void => {
      this.forcedError = error;
    },

    /** Clears a forced failure so {@link GeocodingClient.geocode} can succeed again. */
    forceSuccess: (): void => {
      this.forcedError = null;
    },
  };

  /**
   * Resolves a shipping address to coordinates using the mock address lookup table.
   *
   * @param address - Free-text address; must match a {@link GeocodingMockedAddress} value in dev.
   * @returns Latitude and longitude for the address.
   * @throws {@link AppError} 400 when the address is not in the mock table.
   */
  async geocode(address: string): Promise<Coordinates> {
    if (this.forcedError) {
      throw this.forcedError;
    }

    const coordinates = ADDRESS_COORDINATES[address];
    if (!coordinates) {
      throw new AppError(400, 'Unserviceable shipping address location');
    }

    return coordinates;
  }
}
