# Profile Performance Testing Guide

This guide explains how to use the performance testing utilities to measure profile rendering performance in the Iris Client.

## Quick Start

1. Open the browser console while on a profile page
2. Run performance tests using the global commands:

```javascript
// Run comprehensive performance tests
window.runProfilePerformanceTests()

// Test a specific profile
window.profilePerformanceTest.startProfileTest('npub18psflzah8gjq54t4zyjhezghzg9pvpjhm894f4yex9wpl79t3uxq03v73m')
// Navigate to profile or wait for profile to load
window.profilePerformanceTest.endProfileTest('npub18psflzah8gjq54t4zyjhezghzg9pvpjhm894f4yex9wpl79t3uxq03v73m')

// View collected metrics
window.profilePerformanceTest.getMetrics()
window.profilePerformanceTest.getAverageMetrics()

// Export data for analysis
console.log(window.profilePerformanceTest.exportData())

// Reset metrics
window.profilePerformanceTest.reset()
```

## Metrics Collected

- **Profile Load Time**: Time from test start to profile data availability
- **Network Requests**: Number of network requests during profile loading
- **Active Subscriptions**: Number of active NDK subscriptions
- **Component Render Count**: Total number of component renders
- **Image Load Time**: Time for profile images to load
- **Memory Usage**: JavaScript heap memory usage
- **Component Breakdown**: Render count per component type

## Test Scenarios

The automated test suite includes:

1. **Single Profile Load**: Measures loading a single profile from scratch
2. **Multiple Profile Navigation**: Tests performance when navigating between profiles
3. **Profile with Media**: Tests profiles with large images/banners
4. **High-Activity Profiles**: Tests profiles with many followers/follows

## Performance Monitoring

Components automatically track their render counts:
- ProfileHeader
- Avatar
- Name
- ProfileDetails

Network requests are monitored automatically, with special tracking for image loads.

## Interpreting Results

Key performance indicators:
- Profile load time < 1000ms (good), < 500ms (excellent)
- Network requests < 10 per profile load
- Component renders < 20 per profile load
- Memory usage should remain stable across multiple profile loads

## Troubleshooting

If performance tests show issues:
1. Check network tab for excessive requests
2. Look for unnecessary component re-renders
3. Monitor memory usage for leaks
4. Verify NDK subscription cleanup

## Integration with Development

Performance tracking is integrated into the React component lifecycle and does not interfere with normal app functionality. The tracking can be disabled by removing the `trackComponentRender` calls from components.
