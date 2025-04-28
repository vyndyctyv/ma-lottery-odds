from bs4 import BeautifulSoup
import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

tickets_url = "https://www.masslottery.com/games/draw-and-instants?game_types=Instant"

def pull_urls(url):
    urls = []
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    browser = webdriver.Chrome(options=chrome_options)
    browser.get(url)
    ticket_buttons = browser.find_elements(By.CLASS_NAME, 'games-lobby-tile-container')
    number_of_tickets = len(ticket_buttons)
    for button in range(number_of_tickets):
        ticket_buttons = browser.find_elements(By.CLASS_NAME, 'games-lobby-tile-container')
        if not ticket_buttons:
            browser.implicitly_wait(3)
            ticket_buttons = browser.find_elements(By.CLASS_NAME, 'games-lobby-tile-container')
        ticket_buttons[button].click()
        print(browser.current_url)
        urls.append(browser.current_url)
        browser.get(url)
    return urls


df = pd.DataFrame(pull_urls(tickets_url))
df.to_csv('ticket_urls.csv', index=False)