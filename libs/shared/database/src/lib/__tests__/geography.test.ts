import { Pool } from 'pg';

test('When ST_Distance is called with two points, then it returns the correct distance in meters', async () => {
  // ARRANGE
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'],
  });

  // New York City: 40.7128, -74.0060
  // Los Angeles: 34.0522, -118.2437
  const nyc = { lat: 40.7128, lng: -74.006 };
  const la = { lat: 34.0522, lng: -118.2437 };

  // ACT
  const result = await pool.query(
    `SELECT ST_Distance(
      ST_GeogFromText('SRID=4326;POINT(${nyc.lng} ${nyc.lat})'),
      ST_GeogFromText('SRID=4326;POINT(${la.lng} ${la.lat})')
    ) AS distance`,
  );
  await pool.end();

  // ASSERT
  const distanceKm = parseFloat(result.rows[0].distance) / 1000;
  // NYC to LA is approximately 3944 km
  expect(distanceKm).toBeGreaterThan(3900);
  expect(distanceKm).toBeLessThan(4000);
});
