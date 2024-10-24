// EDIT THIS FILE TO COMPLETE ASSIGNMENT QUESTION 1
const { chromium } = require("playwright");


function getMemoryUsage() {
  // used to see that streaming approach is more memory efficient
  const usage = process.memoryUsage();
  return {
    heapTotal: formatMemoryUsage(usage.heapTotal),
    heapUsed: formatMemoryUsage(usage.heapUsed),
    external: formatMemoryUsage(usage.external),
    rss: formatMemoryUsage(usage.rss)
  };
}

function formatMemoryUsage(bytes) {
  return `${Math.round(bytes / 1024 / 1024 * 100) / 100} MB`;
}


async function getNextPage(page) {
   /**
  * 403 Error Handling for Hacker News Rate Limiting
  * 
  * The Issue:
  * When rapidly navigating through pages on Hacker News, the site returns 403 Forbidden
  * errors as part of its rate limiting protection. This appears after a random number
  * of requests and is likely server-side protection against scraping/crawler activities.
  * 
  * Investigation:
  * - Initially observed as a "Sorry" HTML page being served
  * - Further investigation showed it's triggered by a 403 HTTP response
  * - Happens regardless of request timing or pattern
  * - Server appears to track requests by IP and enforces strict rate limiting
  * 
  * Our Mitigation Attempts:
  * 1. Added random delays (1-3 seconds) between page requests
  * 2. Detection of 403 responses in navigation
  * 3. Considered multiple browser contexts (but wouldn't help with IP-based limiting)
  * 
  * Current Approach:
  * - Detect 403 responses during navigation
  * - Add randomized delays between requests to reduce rate limit triggers
  * - Gracefully handle cases where we can't complete all checks due to rate limiting
  * 
  * Limitations:
  * This is fundamentally a server-side restriction and can't be fully circumvented.
  * For complete testing, you might need to:
  * - Use multiple IPs
  * - Implement longer cooldown periods
  * - Reduce the number of pages checked in a single session
  */
  try {
    // Random delay didn't help as the 403 errors were happening at the same index despite the delay
    // const delay = 1000 + Math.random() * 2000;
    // console.log(`⏲️ Adding delay of ${Math.round(delay/1000)} seconds...`);
    // await page.waitForTimeout(delay);

    const nextPageLink = await page.locator('#hnmain > tbody > tr:nth-child(3) > td > table > tbody > tr:nth-child(92) > td.title > a');
    
    if (await nextPageLink.count() === 0) {
      console.log("❌ Couldn't find next page link");
      return false;
    }
    
    // Wait for both navigation and potential error responses
    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('news.ycombinator.com')),
      nextPageLink.click(),
      page.waitForLoadState('networkidle')
    ]);

    // Check if we got a 403 error
    if (response && response.status() === 403) {
      console.log('⚠️ Detected rate limit (403 Forbidden)');
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('❌ Error getting next page:', error);
    return false;
  }
}


async function compareTimestamps(currentTimestamp, previousTimestamp, previousMinutes) {
  // Used in both approaches as the comparison logic is the same
  const currentMinutes = parseTimestamp(currentTimestamp);
  
  if (previousTimestamp !== null && previousMinutes > currentMinutes) {
    console.log(`❌ Order violation: ${previousTimestamp} is older than ${currentTimestamp}`);
    return {
      isOrdered: false,
      currentMinutes
    };
  }
  
  return {
    isOrdered: true,
    currentMinutes
  };
}

function parseTimestamp(timestamp) {
  // Helper function to parse timestamp as regular parsing can lead to errors
  const number = parseInt(timestamp);
  const unit = timestamp.toLowerCase();
  
  if (unit.includes('minute')) return number;
  if (unit.includes('hour')) return number * 60;
  if (unit.includes('day')) return number * 24 * 60;
  return number;
}


function logPerformanceMetrics(startTime, processedItems, itemsToCheck) {
  const endTime = performance.now();
  console.log(`⏱️  Time taken: ${((endTime - startTime) / 1000).toFixed(2)}s`);
  console.log(`📊 Total items processed: ${processedItems} / ${itemsToCheck}`);
  console.log("Final memory usage:", getMemoryUsage());
}


function buildTimestampSelectors(itemsPerPage, processedItems, itemsToCheck) {
  const selectorsCount = Math.min(itemsPerPage, itemsToCheck - processedItems);
  return Array.from({ length: selectorsCount }, (_, i) => 
    `#hnmain > tbody > tr:nth-child(3) > td > table > tbody > tr:nth-child(${2 + (i * 3)}) > td.subtext > span > span.age`
  );
}



async function arrayCheck(page, itemsToCheck = 100) {
  console.log("\n--- Using For Loop Approach ---");
  let isOrdered = true;
  const startTime = performance.now();
  const itemsPerPage = 30;
  let processedItems = 0;
  let allTimestamps = [];
  let previousTimestamp = null;
  let previousMinutes = null;

  try {
    while (processedItems < itemsToCheck) {
      const selectors = buildTimestampSelectors(itemsPerPage, processedItems, itemsToCheck);

      const pageTimestamps = await Promise.all(
        selectors.map(selector => 
          page.locator(selector).first().innerText()
        )
      );

      for (const currentTimestamp of pageTimestamps) {
        const result = await compareTimestamps(currentTimestamp, previousTimestamp, previousMinutes);
        if (!result.isOrdered) {
          return false;
        }
        previousTimestamp = currentTimestamp;
        previousMinutes = result.currentMinutes;
      }

      allTimestamps = [...allTimestamps, ...pageTimestamps];
      processedItems += pageTimestamps.length;

      if (processedItems < itemsToCheck) {
        const success = await getNextPage(page);
        if (!success) {
          console.log("❌ Navigation failed - ending early");
          break;
        }
      }
    }

    logPerformanceMetrics(startTime, allTimestamps.length, itemsToCheck);
    return isOrdered;

  } catch (error) {
    console.error("Error while checking timestamps:", error);
    return false;
  }
}

async function streamCheck(page, itemsToCheck = 100) {
  console.log("\n--- Using Streaming Approach ---");
  let isOrdered = true;
  const startTime = performance.now();
  const itemsPerPage = 30;
  let processedItems = 0;
  let previousTimestamp = null;
  let previousMinutes = null;

  try {
    while (processedItems < itemsToCheck) {
      const selectors = buildTimestampSelectors(itemsPerPage, processedItems, itemsToCheck);
      
      for (let i = 0; i < selectors.length; i++) {
        const currentTimestamp = await page.locator(selectors[i]).first().innerText();
        
        const result = await compareTimestamps(currentTimestamp, previousTimestamp, previousMinutes);
        if (!result.isOrdered) {
          return false;
        }
        
        previousTimestamp = currentTimestamp;
        previousMinutes = result.currentMinutes;
      }
      
      processedItems += selectors.length;

      if (processedItems < itemsToCheck) {
        const success = await getNextPage(page);
        if (!success) {
          console.log("❌ Navigation failed - ending early");
          break;
        }
      }
    }

    logPerformanceMetrics(startTime, processedItems, itemsToCheck);
    return isOrdered;

  } catch (error) {
    console.error("Error while checking timestamps:", error);
    return false;
  }
}


async function sortHackerNewsArticles() {
  // Launch a single browser instance
  const browser = await chromium.launch({ headless: false });


  try {
    // // Test For Loop approach
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto("https://news.ycombinator.com/newest");
    const forLoopResult = await arrayCheck(page1);
    console.log("For Loop Result:", forLoopResult);
    await context1.close();

    // // Test Streaming approach
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto("https://news.ycombinator.com/newest");
    const streamResult = await streamCheck(page2);
    console.log("Streaming Result:", streamResult);
    await context2.close();


  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    // console.log("\n --- Browser will stay open for manual verification. ---");
    // Uncomment the following lines if you want to close the browser automatically
    console.log("\n --- Browser closing. ---");
    await browser.close();
  }
}

(async () => {
  await sortHackerNewsArticles();
})();