#This program pulls the ticket information from the MA Lottery Site

import numpy as np
import pandas as pd
import re
from bs4 import BeautifulSoup
from selenium import webdriver
from urllib.parse import quote

def pull_table(url):
    browser = webdriver.Chrome()
    browser.get(url)
    soup=BeautifulSoup(browser.page_source, "html.parser")
    table = soup.find('table')
    table_rows = table.find_all('tr')
    ticket_name = soup.find('title').get_text()
    ticket_price = int(soup.find('div',class_='scratch-game-detail-card-price-text').get_text().replace('$',''))
    total_tickets = re.search(r'(\d+(?:,\d+)*)', soup.find('div',class_='game-prizes-remaining-text-info-container').get_text())
    total_tickets = int(total_tickets.group(0).replace(',',''))
    print(total_tickets)
    ticket = []
    for tr in table_rows:
        td = tr.find_all('td')
        row = [i.text for i in td]
        ticket.append(row)
    clean_ticket = []
    for prizes in ticket:
        if prizes:
            prize = re.search(r'\$(\d+)(?=1\s+in)',prizes[0])
            odds = re.search(r'(\d+(?:\.\d+)?)(?=\s+odds)',prizes[0])
            start = re.search(r'(\d+(?:,\d+)*)(?=\s+Start)',prizes[1])
            claimed = re.search(r'(\d+(?:,\d+)*)(?=\s+Claimed)',prizes[1])
            remaining = re.search(r'(\d+(?:,\d+)*)(?=\s+Remaining)',prizes[1])
            clean_ticket.append([int(prize.group(1))-ticket_price,1 / float(odds.group(0)),int(start.group(0).replace(',','')),int(claimed.group(0).replace(',','')),int(remaining.group(0).replace(',',''))])
    clean_ticket.append([ticket_price*-1, 1 - sum([o[1] for o in clean_ticket]),total_tickets - sum([s[2] for s in clean_ticket]),0,0])
    df = pd.DataFrame(clean_ticket,columns=['Prize','Odds','Start','Claimed','Remaining'])

    df_titled = df.style.set_caption(ticket_name)
    return df_titled

print(pull_table("https://www.masslottery.com/games/draw-and-instants/25-50-and-250-celebration-blowout-2025").to_html())
