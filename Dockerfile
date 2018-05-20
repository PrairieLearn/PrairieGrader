FROM node:carbon

COPY package.json package-lock.json /PrairieGrader/

WORKDIR /PrairieGrader/

RUN npm install \
    && npm --force cache clean

COPY . /PrairieGrader/

CMD ["node", "index.js"]
