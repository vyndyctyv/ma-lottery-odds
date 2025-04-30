
def buy_tickets(df):
    tickets_to_buy = int(input('Please enter a number of tickets to purchase: '))
    attempts_to_average = int(input('How many times do you want to run this simulation?: '))
    nets = []
    for x in range(attempts_to_average):
        net = 0
        for i in range(tickets_to_buy):
            sample = df["Prize"].sample(n=1, weights=df['Odds'], replace=True).tolist()[0]
            net+=sample
        nets.append(net)
    result = sum(nets) / len(nets)
    print(f'If you buy {tickets_to_buy} tickets, on average your net will be: ${result}')

def buy_until_win(df):
    goal_prize = int(input('Please enter the ticket you want to hit: '))
    tries = []
    hit_prize = False
    while hit_prize == False:
        sample = df["Prize"].sample(n=1, weights=df['Odds'], replace=True).tolist()[0]
        if sample < goal_prize:
            tries.append(sample)
        else:
            tries.append(sample)
            hit_prize = True
    print(f'In this simulated attempt, it took you {len(tries)} tries to reach the ${goal_prize} ticket, yielding ${sum(tries)}.')

def break_or_broke(df, num_of_tickets=5, attempts_to_average=50):
    results = []
    attempt = []
    ticket_price = df['Prize'].iloc[-1]
    for i in range(attempts_to_average):
        money_earned = 0
        attempts = 0
        while (money_earned+ticket_price >= num_of_tickets*ticket_price) and not (money_earned>0):
            sample = df["Prize"].sample(n=1, weights=df['Odds'], replace=True).tolist()[0]
            money_earned+=sample
            attempts+=1
        results.append(money_earned)
        attempt.append(attempts)
    results_average = sum(results)/len(results)
    attempt_average = sum(attempt)/len(attempt)
    print(f'You are willing to buy up to {num_of_tickets} ticket(s). On average, you will make {attempt_average} pull(s) and you will earn ${results_average}.')
    return results_average
    
