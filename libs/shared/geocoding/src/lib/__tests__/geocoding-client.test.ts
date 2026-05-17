import { AppError } from '@oms/shared/util-errors';
import { GeocodingAddress, GeocodingClient } from '../geocoding-client';

describe('GeocodingClient', () => {
  test('When geocoding "191 Peachtree St NE, Atlanta, GA", then it returns the Atlanta coordinates', () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = client.geocode(GeocodingAddress.Atlanta);

    // ASSERT
    expect(coords).toEqual({ lat: 33.7578, lng: -84.3876 });
  });

  test('When geocoding "Millennium Park, Chicago, IL", then it returns the Chicago coordinates', () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = client.geocode(GeocodingAddress.Chicago);

    // ASSERT
    expect(coords).toEqual({ lat: 41.8826, lng: -87.6227 });
  });

  test('When geocoding "2100 Ross Ave, Dallas, TX", then it returns the Dallas coordinates', () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = client.geocode(GeocodingAddress.Dallas);

    // ASSERT
    expect(coords).toEqual({ lat: 32.7875, lng: -96.7963 });
  });

  test('When geocoding "1701 Wynkoop St, Denver, CO", then it returns the Denver coordinates', () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = client.geocode(GeocodingAddress.Denver);

    // ASSERT
    expect(coords).toEqual({ lat: 39.7532, lng: -105.0001 });
  });

  test('When geocoding "400 E Van Buren St, Phoenix, AZ", then it returns the Phoenix coordinates', () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = client.geocode(GeocodingAddress.Phoenix);

    // ASSERT
    expect(coords).toEqual({ lat: 33.4504, lng: -112.0675 });
  });

  test('When geocoding an unknown address, then the thrown AppError has statusCode 400', () => {
    // ARRANGE
    const client = new GeocodingClient();
    // ACT
    let thrownError: unknown;
    try {
      client.geocode('Unknown Address, Nowhere, XX');
    } catch (err) {
      thrownError = err;
    }

    // ASSERT
    expect(thrownError).toBeInstanceOf(AppError);
    expect((thrownError as AppError).statusCode).toBe(400);
  });

  test('When forceFailure is called, then geocode throws the injected error instead of doing a lookup', () => {
    // ARRANGE
    const client = new GeocodingClient();
    const injectedError = new AppError(503, 'Geocoding service unavailable');
    client.testables.forceFailure(injectedError);

    // ACT & ASSERT
    expect(() => client.geocode(GeocodingAddress.Atlanta)).toThrow(injectedError);
  });

  test('When forceSuccess is called after forceFailure, then geocode resumes normal lookup', () => {
    // ARRANGE
    const client = new GeocodingClient();
    client.testables.forceFailure();
    client.testables.forceSuccess();

    // ACT
    const coords = client.geocode(GeocodingAddress.Atlanta);

    // ASSERT
    expect(coords).toEqual({ lat: 33.7578, lng: -84.3876 });
  });
});
