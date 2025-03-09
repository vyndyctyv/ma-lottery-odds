#This program pulls the ticket information from the MA Lottery Site

import numpy as np
import pandas as pd
import re
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

def pull_table(url):
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    browser = webdriver.Chrome(options=chrome_options)
    browser.get(url)
    soup=BeautifulSoup(browser.page_source, "html.parser")
    table = soup.find('table')
    table_rows = table.find_all('tr')
    ticket_name = soup.find('title').get_text()
    ticket_price = int(soup.find('div',class_='scratch-game-detail-card-price-text').get_text().replace('$',''))
    total_tickets = re.search(r'(\d+(?:,\d+)*)', soup.find('div',class_='game-prizes-remaining-text-info-container').get_text())
    total_tickets = int(total_tickets.group(0).replace(',',''))
    ticket = []
    for tr in table_rows:
        td = tr.find_all('td')
        row = [i.text for i in td]
        ticket.append(row)
    clean_ticket = []
    for prizes in ticket:
        if prizes:
            prize = re.search(r'\$(\d+(?:,\d+)*)(\s.*)?(\s.*)?(?=1\s+in)',prizes[0])
            odds = re.search(r'(?<=in\s)(\d{1,3}(?:,\d{3})*(?:\.\d+)?)(?=\s+odds)',prizes[0])
            start = re.search(r'(\d+(?:,\d+)*)(?=\s+Start)',prizes[1])
            claimed = re.search(r'(\d+(?:,\d+)*)(?=\s+Claimed)',prizes[1])
            remaining = re.search(r'(\d+(?:,\d+)*)(?=\s+Remaining)',prizes[1])
            clean_ticket.append([int(prize.group(1).replace(',',''))-ticket_price,1 / float(odds.group(0).replace(',','')),int(start.group(0).replace(',','')),int(claimed.group(0).replace(',','')),int(remaining.group(0).replace(',',''))])
    losing_ticket = [ticket_price*-1, 1 - sum([o[1] for o in clean_ticket]),total_tickets - sum([s[2] for s in clean_ticket])]
    losing_remaining = int(sum([r[4] for r in clean_ticket])*losing_ticket[1]/(1 - losing_ticket[1]))
    losing_claimed = losing_ticket[2]-losing_remaining
    losing_ticket.append(losing_claimed)
    losing_ticket.append(losing_remaining)
    clean_ticket.append(losing_ticket)
    df = pd.DataFrame(clean_ticket,columns=['Prize','Odds','Start','Claimed','Remaining'])
    return df,ticket_name,url

def pull_tickets(ticket_urls):
    ticket_dfs = []
    for ticket in ticket_urls:
        ticket_dfs.append(pull_table(ticket))
    return ticket_dfs