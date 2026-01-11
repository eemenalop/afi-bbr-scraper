require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { sendNotification, sendErrorScreenshot } = require('./telegramNotifier');
const cron = require('node-cron');

const DB_FILE_PATH = path.join(__dirname, 'movements_db.json');

// Helper function to wait for selector with automatic screenshot on error
async function waitForSelectorWithScreenshot(page, selector, options = {}) {
    try {
        return await page.waitForSelector(selector, options);
    } catch (error) {
        console.error(`Failed to find selector: ${selector}. Taking screenshot...`);
        const screenshotPath = `error-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot saved. Sending to Telegram...`);
        
        // Enviar screenshot por Telegram
        await sendErrorScreenshot(
            screenshotPath, 
            `Error al buscar el selector: ${selector}\n\nTimeout: ${options.timeout || 30000}ms`
        );
        
        throw error;
    }
}

async function runScraper() {
    const realTime = new Date().toLocaleString('es-DO', {timeZone: 'America/Santo_Domingo'})
    console.log(`[${realTime}] - Start the bot...`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            slowMo: 100,
            args: [
                '--ignore-certificate-errors',
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--memory-pressure-off',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-images'
            ]
        });
        const principalPage = await browser.newPage();
        await principalPage.goto('https://www.afireservas.com/')
        console.log('Home Page Loaded. Looking for the button to access the login');
        const dropDownSelectorButton = '#enLinea';
        await waitForSelectorWithScreenshot(principalPage, dropDownSelectorButton);
        await principalPage.click(dropDownSelectorButton);
        const newPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));

        const firstOptionSelector = 'a[href="https://afienlinea.afireservas.com:7004/G3A/inicio/login.pub"]';
        await waitForSelectorWithScreenshot(principalPage, firstOptionSelector);
        await principalPage.click(firstOptionSelector);
        const page = await newPagePromise;
        await principalPage.close();

        console.log('Login Home page loaded. Interacting with the form...');
        //Wait and select an option of dropdown menu
        const personTypeSelectorId = '#selectTipoPersona';
        const optionPersonTypeValue = 'N';
        await waitForSelectorWithScreenshot(page, personTypeSelectorId);
        await page.select(personTypeSelectorId, optionPersonTypeValue);

        //Wait and write on user input
        const userInputId = '#userid';
        const myUser = process.env.MY_USER;
        await waitForSelectorWithScreenshot(page, userInputId);
        await page.type(userInputId, myUser);

        //Wait and click on password field (for enable keyboard)
        const passInputId = '#auth_pass';
        await waitForSelectorWithScreenshot(page, passInputId);
        await page.click(passInputId);

        console.log('Virtual keyboard actived. Typing password...');

        //Mapping the number pad
        console.log('Mapping the number pad...');
        await waitForSelectorWithScreenshot(page, '.tecla_numero');
        const numberMap = await page.evaluate(() => {
            const mapa = {};
            const numberKeys = document.querySelectorAll('.tecla_numero');
            numberKeys.forEach(key => {
                const numberText = key.innerText.trim();
                const keyId = key.id;
                if(numberText && keyId){
                    mapa[numberText] = `#${keyId}`;
                }
            });
            return mapa;
        });
        
        //Write the password ussing map and logic state
        const myPassword = process.env.PASSWORD;
        
        // Verify credentials are loaded (show partial for debugging)
        console.log(`User loaded: ${myUser ? myUser.substring(0, 3) + '***' : 'NOT LOADED'}`);
        console.log(`Password loaded: ${myPassword ? myPassword.substring(0, 2) + '***' + ' (length: ' + myPassword.length + ')' : 'NOT LOADED'}`);
        
        const toggleCaseSelector = 'a.tt_SYM_UPP';
        let actualKeyboardState = 'UPPERCASE';
        console.log('Starting enter password...')
        console.log('🔍 DEBUG: Password characters being pressed:');
        
        for(const char of myPassword){
            try {
                // DEBUG: Log cada tecla que se está presionando
                console.log(`  → Pressing: "${char}" (Type: ${!isNaN(parseInt(char)) ? 'Number' : (char >= 'A' && char <= 'Z') ? 'Uppercase' : (char >= 'a' && char <= 'z') ? 'Lowercase' : 'Special'})`);
                
                const IsNumber = !isNaN(parseInt(char));
                const IsUpperCase = char >= 'A' && char <= 'Z';
                const IsLowerCase = char >= 'a' && char <= 'z';

                if(IsNumber){
                    const numberSelector = numberMap[char];
                    if (!numberSelector) throw new Error(`Number ${char} not found in map.`);
                    await page.click(numberSelector);
                    console.log(`    ✓ Clicked number: ${char}`);
                } else {
                    if(IsUpperCase || IsLowerCase){
                        const requiredState = IsUpperCase ? 'UPPERCASE' : 'LOWERCASE';
                        if(actualKeyboardState !== requiredState){
                            await page.click(toggleCaseSelector);
                            actualKeyboardState = requiredState;
                            console.log(`    ↔ Toggled keyboard to: ${requiredState}`);
                            await new Promise(r => setTimeout(r, 150));
                        }
                    }

                const keyToFind = (IsUpperCase || IsLowerCase) ? char.toUpperCase() : char;
                const selectorXPath = `//*[normalize-space()="${keyToFind}"]`;
                const key = await waitForSelectorWithScreenshot(page, `xpath/${selectorXPath}`, {visible: true, timeout: 5000});
                await key.click();
                console.log(`    ✓ Clicked key: ${keyToFind}`);
                }
                await new Promise(r => setTimeout(r, 150));

            } catch (error) {
                await browser.close();
                return;
            }
        }
        console.log('Password entry complete.')

        const loginButtonSelector = '.btn.poplight';
        await waitForSelectorWithScreenshot(page, loginButtonSelector);
        await page.click(loginButtonSelector);

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        
        // REAL login validation - check if login actually succeeded
        const currentUrl = page.url();
        console.log('Post-login URL:', currentUrl);
        
        if (currentUrl.includes('failed') || currentUrl.includes('login.pub')) {
            console.error('❌ LOGIN FAILED - Credentials were rejected');
            const screenshotPath = `login-failed-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            await sendErrorScreenshot(screenshotPath, `Login falló - revisa las credenciales en Railway\n\nURL: ${currentUrl}`);
            throw new Error('Login failed - invalid credentials or login process error');
        }
        
        console.log('✅ Successfully logged in!');

        // Clear browser storage to free memory (BUT NOT COOKIES - they contain session data)
        await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
            // NOTE: NOT clearing cookies because they contain authentication session
        });

        // Wait for page to fully render after login (increased for Railway)
        await new Promise(r => setTimeout(r, 5000));

        const accountSetting = '.oth';
        // Removed 'visible: true' for better compatibility with headless mode in Railway
        await waitForSelectorWithScreenshot(page, accountSetting, {timeout: 60000});
        await page.hover(accountSetting);

        const transationalWeb = 'a[onclick="osm_enviarFormulario(\'form_filial_1\');"]';
        await waitForSelectorWithScreenshot(page, transationalWeb);
        await page.click(transationalWeb);

        const fundSelector = 'a[onclick="$(\'#tabla_1\').toggle(); return false;"]';
        await waitForSelectorWithScreenshot(page, fundSelector);
        await page.click(fundSelector);

        const accountNumber = 'a[onclick^="verDetalle"]';
        await waitForSelectorWithScreenshot(page, accountNumber);
        await page.click(accountNumber);
        console.log('Successfully navigated to the target page! Starting data extraction...');

        //START OF DATA EXTRACTION 

        const principalInfoSelector = 'div.score:not([style*="display:none"])';
        await waitForSelectorWithScreenshot(page, principalInfoSelector);
        const principalInfo = await page.evaluate((selector) => {
            const infoContainer = document.querySelector(selector);
            if(!infoContainer) return {};
            const data = {};
            const rows = infoContainer.querySelectorAll('.pbox, .pbox2');
            rows.forEach(row => {
                const label = row.querySelector('label');
                const value = row.querySelector('b');
                if(label && value){
                    const key = label.innerText.trim();
                    const val = value.innerText.trim();
                    data[key] = val;
                }
            });
            return data;
        }, principalInfoSelector);

        // Extraction of the movement table
        const movementSelector = 'table.tb-02';
        await waitForSelectorWithScreenshot(page, movementSelector);

        const movementsData = await page.evaluate((selector) => {
            const table = document.querySelector(selector);
            if (!table) return {headers: [], rows: []};
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            if (rows.length === 0) return { headers: [], rows: [] };
            const headerCells = Array.from(rows[0].querySelectorAll('td'));
            const headers = headerCells.map(cell => cell.innerText.trim());
            const dataRows = rows.slice(1).map(fila => {
                const celdas = Array.from(fila.querySelectorAll('td'));
                return celdas.map(celda => celda.innerText.trim());
            });
            return { headers, rows: dataRows };
        }, movementSelector);

        const formattedMovements = movementsData.rows.map(row => {
            const movementObject = {};
            movementsData.headers.forEach((header, index) => {
                movementObject[header] = row[index];
            });
            return movementObject;
            });

        console.log('Data extraction complete.');

        let previousMovements = [];
        try {
            const data = await fs.readFile(DB_FILE_PATH, 'utf-8');
            const parsed = JSON.parse(data);
            // Only keep last 100 movements to limit memory usage
            previousMovements = Array.isArray(parsed) ? parsed.slice(-100) : [];
        } catch (error) {
            console.log('Memory file not found. A new one will be created.');
        }
        const previousMovementsSet = new Set(previousMovements.map(m => JSON.stringify(m)));
        const newMovements = formattedMovements.filter(m => !previousMovementsSet.has(JSON.stringify(m)));

        if (newMovements.length > 0) {
            console.log(`¡${newMovements.length} new movement(s) found!`);
            await sendNotification(principalInfo, newMovements);
        } else {
            console.log('No new movements found.');
        }
        await fs.writeFile(DB_FILE_PATH, JSON.stringify(formattedMovements, null, 2));
        console.log('Current movements saved to memory file.');
        await page.close(); // Close the page immediately after data extraction

        // --- END OF DATA EXTRACTION ---
    } catch (error) {
        console.error('An error occurred during the process:', error);
    } finally {
        if (browser) {
            // Close all remaining pages first
            const pages = await browser.pages();
            await Promise.all(pages.map(page => page.close()));
            
            console.log('Process complete. Closing the bot...');
            await browser.close();
        }
    }    
}

//SCHEDULING LOGIC

// Flag to prevent concurrent executions
let isRunning = false;

// TESTING: Every 2 minutes
const cronSchedule = '*/3 * * * *';

// PRODUCTION: Every day at 8:23 PM (uncomment when testing is complete)
//const cronSchedule = '23 20 * * *';

cron.schedule(cronSchedule, () => {
    console.log('====================================================');
    const trigger = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
    console.log(`CRON: [${trigger}] - It's time to execute the task.`);

    // Check if scraper is already running
    if (isRunning) {
        console.log('⚠️  Scraper is already running, skipping this execution');
        return;
    }

    // Set flag and run scraper
    isRunning = true;
    runScraper().finally(() => {
        isRunning = false;
    });
}, {
    schedule: true,
    timezone: "America/Santo_Domingo"
});

console.log(`El scraper se ha iniciado y está en modo de espera.`);
console.log(`La próxima ejecución está programada según el horario: ${cronSchedule}`);
console.log(`Zona Horaria: America/Santo_Domingo`);