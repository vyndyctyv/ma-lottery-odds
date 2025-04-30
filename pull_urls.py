import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

tickets_url = "https://www.masslottery.com/games/draw-and-instants?game_types=Instant" #Page where all tickets are listed (filtering for only instant tickets)

def pull_urls(url): #Find every URL of instant tickets
    urls = []
    chrome_options = Options()
    chrome_options.add_argument("--headless=new") #Headless browser
    browser = webdriver.Chrome(options=chrome_options)
    browser.get(url)
    ticket_buttons = browser.find_elements(By.CLASS_NAME, 'games-lobby-tile-container') #Find all page instances of clickable buttons with class "games-lobby-tile-container"
    number_of_tickets = len(ticket_buttons)
    for button in range(number_of_tickets):
        ticket_buttons = browser.find_elements(By.CLASS_NAME, 'games-lobby-tile-container') #Find all again to avoid stale references when page reloads
        if not ticket_buttons:
            browser.implicitly_wait(3)
            ticket_buttons = browser.find_elements(By.CLASS_NAME, 'games-lobby-tile-container')
        ticket_buttons[button].click()
        urls.append(browser.current_url) #Append current URL of ticket page to list
        browser.get(url)
    return urls


df = pd.DataFrame(pull_urls(tickets_url)) #Save ticket URL list as Pandas Dataframe
df.to_csv('ticket_urls.csv', index=False) #Save ticket URL Dataframe as .csv