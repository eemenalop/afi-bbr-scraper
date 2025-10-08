require('dotenv').config();
const puppeteer = require('puppeteer');

async function run() {
    console.log('Start the bot...');

    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 100,
        args: ['--ignore-certificate-errors']
    });
    const page = await browser.newPage();
    await page.goto('https://afienlinea.afireservas.com:7004/G3A/inicio/login.pub?ret=jdy2HWEfJFjjFgXKYfViFzsiW%2BpQOdUtKoo8dQ9VHzcUqozu9%2FHWrFj07cpi67wQ6Sp%2FSxfqqeTj004ONEb7X1N7F19Nre%2B4gAHvRuJUoMUumJBl5XxH2ZSkgL9qzeGnQFm33KJZhUQgu4UwN35wKVLGZPO%2BwKPZp2gdeBjHfIg%3D&FIL=1&cfp=1&cambio_clave=&osm_lastpage=%2Fservice%2Flogin.pub&osm_ticket=');

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
    console.log('Mapping the number pad...');
    await page.waitForSelector('.tecla_numero');
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
    console.log('Number map created:', numberMap);

    //Write the password ussing map and logic state
    const myPassword = process.env.MY_PASSWORD;
    const toggleCaseSelector = 'a.tt_SYM_UPP';
    let actualKeyboardState = 'UPPERCASE';
    console.log(`Keyboard initial state: ${actualKeyboardState}`);
    for(const char of myPassword){
        try {
            const IsNumber = !isNaN(parseInt(char));
            const IsUpperCase = char >= 'A' && char <= 'Z';
            const IsLowerCase = char >= 'a' && char <= 'z';

            if(IsNumber){
                const numberSelector = numberMap[char];
                if (!numberSelector) throw new Error(`Number ${char} not found in map.`);
                console.log(`Character '${char}' is a number. Clicking selector: ${numberSelector}`);
                await page.click(numberSelector);
            } else {
                if(IsUpperCase || IsLowerCase){
                    const requiredState = IsUpperCase ? 'UPPERCASE' : 'LOWERCASE';
                    if(actualKeyboardState !== requiredState){
                        console.log(`Change keyboard mode to: ${requiredState}`);
                        await page.click(toggleCaseSelector);
                        actualKeyboardState = requiredState;
                        await new Promise(r => setTimeout(r, 150));
                    }
                }

            const keyToFind = (IsUpperCase || IsLowerCase) ? char.toUpperCase() : char;
            const selectorXPath = `//*[normalize-space()="${keyToFind}"]`;
            console.log(`Looking for key for character: '${char}' (searching as '${keyToFind}')`);
            const key = await page.waitForSelector(`xpath/${selectorXPath}`, {visible: true, timeout: 5000});
            await key.click();
            }

            console.log(`The key is clicked with charcter: '${char}'`);
            await new Promise(r => setTimeout(r, 150));

        } catch (error) {
            console.log(`Error attempting click on key with char '${char}': `, error);
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
}

run();

//Tipo Persona = id:selectTipoPersona
//Usuario = id: userid
//Contrasena = id:auth_pass