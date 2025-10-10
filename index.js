require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { sendNotification } = require('./telegramNotifier');
const cron = require('node-cron');

const DB_FILE_PATH = path.join(__dirname, 'movements_db.json');

async function runScraper() {
    const realTime = new Date().toLocaleString('es-DO', {timeZone: 'America/Santo_Domingo'})
    console.log(`[${realTime}] - Start the bot...`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            slowMo: 100,
            args: ['--ignore-certificate-errors', '--no-sandbox', '--disable-setuid-sandbox']
        });
        const principalPage = await browser.newPage();
        await principalPage.goto('https://www.afireservas.com/')
        console.log('Home Page Loaded. Looking for the button to access the login');
        const dropDownSelectorButton = '#enLinea';
        await principalPage.waitForSelector(dropDownSelectorButton);
        await principalPage.click(dropDownSelectorButton);
        console.log('Dropdown button clicked.');
        const newPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));

        const firstOptionSelector = 'a[href="https://afienlinea.afireservas.com:7004/G3A/inicio/login.pub"]';
        console.log('Waiting for the login option to appear...');
        await principalPage.waitForSelector(firstOptionSelector);
        await principalPage.click(firstOptionSelector);

        const page = await newPagePromise;
        console.log('New login page detected and is now active.');

        console.log('Login Home page loaded. Interacting with the form...');
        //Wait and select an option of dropdown menu
        const personTypeSelectorId = '#selectTipoPersona';
        const optionPersonTypeValue = 'N';
        await page.waitForSelector(personTypeSelectorId);
        await page.select(personTypeSelectorId, optionPersonTypeValue);

        //Wait and write on user input
        const userInputId = '#userid';
        const myUser = process.env.MY_USER;
        await page.waitForSelector(userInputId);
        await page.type(userInputId, myUser);

        //Wait and click on password field (for enable keyboard)
        const passInputId = '#auth_pass';
        await page.waitForSelector(passInputId);
        await page.click(passInputId);

        console.log('Virtual keyboard actived. Typing password...');

        //Mapping the number pad
        console.log('Mapping the number pad...');
        await page.waitForSelector('.tecla_numero');
        const numberMap = await page.evaluate(() => {
            const mapa = {};
            const numberKeys = document.querySelectorAll('.tecla_numero');
            console.log(numberKeys)
            numberKeys.forEach(key => {
                const numberText = key.innerText.trim();
                const keyId = key.id;
                if(numberText && keyId){
                    mapa[numberText] = `#${keyId}`;
                }
            });
            return mapa;
        });
        console.log('Number map created:', numberMap);

        //Write the password ussing map and logic state
        const myPassword = process.env.MY_PASSWORD;
        const toggleCaseSelector = 'a.tt_SYM_UPP';
        let actualKeyboardState = 'UPPERCASE';
        console.log('Starting enter password...')
        for(const char of myPassword){
            try {
                const IsNumber = !isNaN(parseInt(char));
                const IsUpperCase = char >= 'A' && char <= 'Z';
                const IsLowerCase = char >= 'a' && char <= 'z';

                if(IsNumber){
                    const numberSelector = numberMap[char];
                    if (!numberSelector) throw new Error(`Number ${char} not found in map.`);
                    await page.click(numberSelector);
                } else {
                    if(IsUpperCase || IsLowerCase){
                        const requiredState = IsUpperCase ? 'UPPERCASE' : 'LOWERCASE';
                        if(actualKeyboardState !== requiredState){
                            await page.click(toggleCaseSelector);
                            actualKeyboardState = requiredState;
                            await new Promise(r => setTimeout(r, 150));
                        }
                    }

                const keyToFind = (IsUpperCase || IsLowerCase) ? char.toUpperCase() : char;
                const selectorXPath = `//*[normalize-space()="${keyToFind}"]`;
                const key = await page.waitForSelector(`xpath/${selectorXPath}`, {visible: true, timeout: 5000});
                await key.click();
                }
                await new Promise(r => setTimeout(r, 150));

            } catch (error) {
                await browser.close();
                return;
            }
        }
        console.log('Password entry complete.')

        const loginButtonSelector = '.btn.poplight';
        console.log('Clicking the final login button...');
        await page.waitForSelector(loginButtonSelector);
        await page.click(loginButtonSelector);
        console.log('Login button clicked!');

        await page.waitForNavigation();
        console.log('Successfully logged in!');

        const accountSetting = '.oth';
        await page.waitForSelector(accountSetting);
        await page.hover(accountSetting);
        console.log('Account Settings clicked!');

        const transationalWeb = 'a[onclick="osm_enviarFormulario(\'form_filial_1\');"]';
        await page.waitForSelector(transationalWeb);
        await page.click(transationalWeb);
        console.log('Web Transaccional clicked!');

        const fundSelector = 'a[onclick="$(\'#tabla_1\').toggle(); return false;"]';
        await page.waitForSelector(fundSelector);
        await page.click(fundSelector);
        console.log('Investment fund selected!');

        const accountNumber = 'a[onclick^="verDetalle"]';
        await page.waitForSelector(accountNumber);
        await page.click(accountNumber);
        console.log('Account number clicked!');
        console.log('Successfully navigated to the target page! Starting data extraction...');

        //START OF DATA EXTRACTION 

        const principalInfoSelector = 'div.score:not([style*="display:none"])';
        await page.waitForSelector(principalInfoSelector);
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
        console.log('--- Principal Information ---');
        console.log(principalInfo);

        // Extraction of the movement table
        const movementSelector = 'table.tb-02';
        await page.waitForSelector(movementSelector);

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

        console.log('--- MOVEMENT DETAILS ---');
        console.log(formattedMovements);

        console.log('Data extraction complete.');

        let previousMovements = [];
        try {
            const data = await fs.readFile(DB_FILE_PATH, 'utf-8');
            previousMovements = JSON.parse(data);
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

        // --- END OF DATA EXTRACTION ---
    } catch (error) {
        console.error('An error occurred during the process:', error);
    } finally {
        if (browser) {
                console.log('Process complete. Closing the bot...');
                await browser.close();
            }
    }    
}

//SCHEDULING LOGIC

const cronSchedule = '0 */20 * * *';

cron.schedule(cronSchedule, () => {
    console.log('====================================================');
    const trigger = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
    console.log(`CRON: [${trigger}] - It's time to execute the task.`);

    runScraper();
}, {
    schedule: true,
    timezone: "America/Santo_Domingo"
});

console.log(`El scraper se ha iniciado y está en modo de espera.`);
console.log(`La próxima ejecución está programada según el horario: ${cronSchedule}`);
console.log(`Zona Horaria: America/Santo_Domingo`);