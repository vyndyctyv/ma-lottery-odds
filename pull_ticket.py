import pandas as pd
import re
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

def pull_table(url): #Pulls the information from the tables on each of the tickets' pages
    chrome_options = Options()
    chrome_options.add_argument("--headless=new") #Headless browser
    browser = webdriver.Chrome(options=chrome_options)
    browser.get(url)
    soup=BeautifulSoup(browser.page_source, "html.parser") #Parse HTML
    table = soup.find('table') #Find lottery odds information (only 1 table per page)
    if table:
        table_rows = table.find_all('tr') #Find all table cells
        ticket_name = re.search(r'(.*)(?= \| Games \| Massachusetts Lottery)',soup.find('title').get_text()).group(0) #Pull ticket name without common ending
        ticket_price = int(soup.find('div',class_='scratch-game-detail-card-price-text').get_text().replace('$','')) #Pull ticket price
        total_tickets = re.search(r'(\d+(?:,\d+)*)', soup.find('div',class_='game-prizes-remaining-text-info-container').get_text()) #Find total tickets available for sale
        total_tickets = int(total_tickets.group(0).replace(',','')) #Convert total tickets to int
        ticket = []
        for tr in table_rows: #Append all cell information to ticket list
            td = tr.find_all('td')
            row = [i.text for i in td]
            ticket.append(row)
        clean_ticket = []
        for prizes in ticket: #Uses regex to pull information regarding the prize, odds, starting, and remaining tickets to the clean_ticket list
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
    else:
        print(f'{url} is not functioning.') #Failsafe if browser is unable to load the table/ticket page is deprecated

def pull_tickets(ticket_urls): #Pulls the dataframe from each ticket using pull_table()
    ticket_dfs = []
    for ticket in ticket_urls['0']:
        try:
            ticket_dfs.append(pull_table(ticket))
        except:
            print(f'Issue with ticket: {ticket}')
    return ticket_dfs