import { AppError } from '@oms/shared/util-errors';
import { GeocodingMockedAddress, GeocodingClient } from '../geocoding-client';

describe('GeocodingClient', () => {
  test('When geocoding "191 Peachtree St NE, Atlanta, GA", then it returns the Atlanta coordinates', async () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = await client.geocode(GeocodingMockedAddress.Atlanta);

    // ASSERT
    expect(coords).toEqual({ lat: 33.7578, lng: -84.3876 });
  });

  test('When geocoding "Millennium Park, Chicago, IL", then it returns the Chicago coordinates', async () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = await client.geocode(GeocodingMockedAddress.Chicago);

    // ASSERT
    expect(coords).toEqual({ lat: 41.8826, lng: -87.6227 });
  });

  test('When geocoding "2100 Ross Ave, Dallas, TX", then it returns the Dallas coordinates', async () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = await client.geocode(GeocodingMockedAddress.Dallas);

    // ASSERT
    expect(coords).toEqual({ lat: 32.7875, lng: -96.7963 });
  });

  test('When geocoding "1701 Wynkoop St, Denver, CO", then it returns the Denver coordinates', async () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = await client.geocode(GeocodingMockedAddress.Denver);

    // ASSERT
    expect(coords).toEqual({ lat: 39.7532, lng: -105.0001 });
  });

  test('When geocoding "400 E Van Buren St, Phoenix, AZ", then it returns the Phoenix coordinates', async () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT
    const coords = await client.geocode(GeocodingMockedAddress.Phoenix);

    // ASSERT
    expect(coords).toEqual({ lat: 33.4504, lng: -112.0675 });
  });

  test('When geocoding an unknown address, then the thrown AppError has statusCode 400', async () => {
    // ARRANGE
    const client = new GeocodingClient();

    // ACT & ASSERT
    await expect(client.geocode('Unknown Address, Nowhere, XX')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('When forceFailure is called, then geocode throws the injected error instead of doing a lookup', async () => {
    // ARRANGE
    const client = new GeocodingClient();
    const injectedError = new AppError(503, 'Geocoding service unavailable');
    client.testables.forceFailure(injectedError);

    // ACT & ASSERT
    await expect(client.geocode(GeocodingMockedAddress.Atlanta)).rejects.toThrow(injectedError);
  });

  test('When forceSuccess is called after forceFailure, then geocode resumes normal lookup', async () => {
    // ARRANGE
    const client = new GeocodingClient();
    client.testables.forceFailure();
    client.testables.forceSuccess();

    // ACT
    const coords = await client.geocode(GeocodingMockedAddress.Atlanta);

    // ASSERT
    expect(coords).toEqual({ lat: 33.7578, lng: -84.3876 });
  });
});
